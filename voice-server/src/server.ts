// Harbor Voice Server
// Standalone WebSocket server for Twilio ConversationRelay + Gemini Flash
// Handles real-time voice AI receptionist with crisis detection

import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'
import { buildVoiceSystemPrompt, PracticeConfig } from './system-prompt'
import {
  scanUtterance,
  analyzeWithSonnet,
  getCrisisResponse,
  getGentleCheckinResponse,
  CrisisAssessment,
} from './crisis-tripwire'

// ── Environment ────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3001', 10)
const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || ''

// ── Clients ────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })

// ── Session tracking ───────────────────────────────────────────────────────
interface CallSession {
  callSid: string
  practiceId: string | null
  practiceConfig: PracticeConfig | null
  conversationHistory: Array<{ role: 'user' | 'model'; parts: [{ text: string }] }>
  transcript: string[]  // Raw transcript for crisis analysis & logging
  callerPhone: string | null
  crisisState: CrisisAssessment | null
  startTime: Date
}

const sessions = new Map<string, CallSession>()

// ── Express app (health check + TwiML endpoint) ───────────────────────────
const app = express()
app.use(express.urlencoded({ extended: true }))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'harbor-voice-server',
    activeCalls: sessions.size,
    uptime: process.uptime(),
  })
})

// TwiML endpoint — Twilio calls this when a voice call comes in.
// Returns TwiML that connects the call to our WebSocket via ConversationRelay.
// Does a quick practice lookup so the welcome greeting is personalized.
app.post('/twiml', async (req, res) => {
  const callerNumber = req.body.From || 'unknown'
  const calledNumber = req.body.To || ''
  const callSid = req.body.CallSid || ''

  console.log(`📞 Incoming call: ${callerNumber} → ${calledNumber} (${callSid})`)

  // Quick practice lookup for personalized greeting
  let welcomeGreeting = 'Thank you for calling, how can I help you today?'
  try {
    if (calledNumber) {
      const digits = calledNumber.replace(/\D/g, '').slice(-10)
      const { data: practices } = await supabase
        .from('practices')
        .select('name, provider_name, ai_name, phone_number')

      if (practices) {
        const match = practices.find(
          (p: any) => p.phone_number?.replace(/\D/g, '').slice(-10) === digits
        )
        if (match) {
          const aiName = match.ai_name || 'Harbor'
          const practiceName = match.name || 'the practice'
          welcomeGreeting = `Thank you for calling ${practiceName}, this is ${aiName}, how can I help you today?`
          console.log(`✓ Personalized greeting for: ${practiceName}`)
        }
      }
    }
  } catch (err) {
    console.warn('⚠️ Could not look up practice for greeting, using default:', err)
  }

  // XML-escape the greeting for safe embedding in TwiML
  const greetingEscaped = welcomeGreeting
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // The WebSocket URL where ConversationRelay will connect
  const wsHost = process.env.VOICE_SERVER_HOST || req.headers.host || 'localhost:3001'
  const wsProtocol = process.env.NODE_ENV === 'production' ? 'wss' : 'ws'
  const wsUrl = `${wsProtocol}://${wsHost}/ws?callerPhone=${encodeURIComponent(callerNumber)}&calledNumber=${encodeURIComponent(calledNumber)}`

  // XML-escape the URL (& → &amp;) so TwiML parses correctly
  const wsUrlEscaped = wsUrl.replace(/&/g, '&amp;')

  // Return TwiML that connects to ConversationRelay
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="${wsUrlEscaped}"
      voice="Google.en-US-Journey-F"
      ttsProvider="Google"
      transcriptionProvider="Google"
      speechModel="telephony"
      language="en-US"
      interruptible="true"
      dtmfDetection="true"
      welcomeGreeting="${greetingEscaped}"
    />
  </Connect>
</Response>`

  res.type('text/xml').send(twiml)
})

// ── HTTP server + WebSocket ────────────────────────────────────────────────
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', async (ws: WebSocket, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`)
  const callerPhone = url.searchParams.get('callerPhone') || null
  const calledNumber = url.searchParams.get('calledNumber') || null

  console.log(`🔌 WebSocket connected | caller: ${callerPhone} | called: ${calledNumber}`)

  // Temp session ID until we get the callSid from the setup message
  let sessionId = `temp-${Date.now()}`

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString())

      switch (message.type) {
        case 'setup':
          await handleSetup(ws, message, callerPhone, calledNumber)
          sessionId = message.callSid
          break

        case 'prompt':
          await handlePrompt(ws, message, sessionId)
          break

        case 'interrupt':
          handleInterrupt(sessionId, message)
          break

        case 'dtmf':
          console.log(`🔢 DTMF received: ${message.digit} (call: ${sessionId})`)
          break

        default:
          console.log(`❓ Unknown message type: ${message.type}`, message)
      }
    } catch (error) {
      console.error('WebSocket message error:', error)
    }
  })

  ws.on('close', () => {
    handleDisconnect(sessionId)
  })

  ws.on('error', (error) => {
    console.error(`WebSocket error (${sessionId}):`, error)
  })
})

// ── Message handlers ───────────────────────────────────────────────────────

async function handleSetup(
  ws: WebSocket,
  message: any,
  callerPhone: string | null,
  calledNumber: string | null
) {
  const callSid = message.callSid
  console.log(`📋 Setup for call: ${callSid}`)

  // Look up practice by the Twilio number that was called
  let practiceId: string | null = null
  let practiceConfig: PracticeConfig | null = null

  if (calledNumber) {
    const digits = calledNumber.replace(/\D/g, '').slice(-10)

    const { data: practices } = await supabase
      .from('practices')
      .select('*')

    if (practices) {
      const match = practices.find(
        (p: any) => p.phone_number?.replace(/\D/g, '').slice(-10) === digits
      )

      if (match) {
        practiceId = match.id
        practiceConfig = {
          therapist_name: match.provider_name || match.name || 'the therapist',
          practice_name: match.name || 'the practice',
          ai_name: match.ai_name || 'Harbor',
          specialties: match.specialties || [],
          hours: match.hours || match.office_hours || undefined,
          location: match.location || match.address || undefined,
          telehealth: match.telehealth ?? match.telehealth_available ?? true,
          insurance_accepted: match.insurance_accepted || [],
          system_prompt_notes: match.system_prompt_notes || undefined,
          emotional_support_enabled: match.emotional_support_enabled ?? true,
          cancellation_policy: match.cancellation_policy || undefined,
          new_patients_accepted: match.accepting_new_patients ?? true,
          waitlist_enabled: match.waitlist_enabled ?? false,
        }
        console.log(`✓ Matched practice: ${practiceConfig.practice_name} (${practiceId})`)
      }
    }
  }

  if (!practiceConfig) {
    console.warn('⚠️ Could not match practice — using default config')
    practiceConfig = {
      therapist_name: 'the therapist',
      practice_name: 'the practice',
    }
  }

  // Build the system prompt
  const systemPrompt = buildVoiceSystemPrompt(practiceConfig)

  // Create session
  const session: CallSession = {
    callSid,
    practiceId,
    practiceConfig,
    conversationHistory: [
      { role: 'user', parts: [{ text: `System: ${systemPrompt}` }] },
      { role: 'model', parts: [{ text: 'Understood. I am ready to take calls as the receptionist.' }] },
    ],
    transcript: [],
    callerPhone,
    crisisState: null,
    startTime: new Date(),
  }

  sessions.set(callSid, session)
}

async function handlePrompt(ws: WebSocket, message: any, sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) {
    console.warn(`No session found for ${sessionId}`)
    sendText(ws, "I'm sorry, I'm having a technical issue. Could you please call back?", true)
    return
  }

  const utterance = message.voicePrompt || ''
  console.log(`🗣️ Caller: "${utterance}" (${sessionId})`)

  // Save to raw transcript
  session.transcript.push(`Caller: ${utterance}`)

  // ── Crisis tripwire scan ─────────────────────────────────────────────
  const scan = scanUtterance(utterance)

  if (scan.immediateCrisis) {
    // Tier 1: Immediate crisis — skip LLM, respond with crisis protocol NOW
    console.log(`🚨 IMMEDIATE CRISIS DETECTED: ${scan.matchedPhrases.join(', ')} (${sessionId})`)

    const crisisResponse = getCrisisResponse(session.practiceConfig?.therapist_name || 'your therapist')
    sendText(ws, crisisResponse, true)
    session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${crisisResponse}`)

    // Update crisis state
    session.crisisState = {
      level: 'crisis',
      immediate: true,
      triggerPhrases: scan.matchedPhrases,
      recommendedAction: 'crisis_protocol',
    }

    // Fire-and-forget: alert therapist, log to DB
    alertTherapist(session, scan.matchedPhrases).catch(console.error)
    logCrisisAlert(session, scan.matchedPhrases).catch(console.error)
    return
  }

  if (scan.tripwireTriggered) {
    // Tier 2: Tripwire fired — get Gemini response AND run Sonnet analysis in parallel
    console.log(`⚠️ Tripwire triggered: ${scan.matchedPhrases.join(', ')} (${sessionId})`)

    // Run both in parallel
    const [geminiResponse, sonnetAssessment] = await Promise.all([
      getGeminiResponse(session, utterance),
      analyzeWithSonnet(
        session.transcript.join('\n'),
        scan.matchedPhrases,
        {
          therapistName: session.practiceConfig?.therapist_name || 'the therapist',
          practiceName: session.practiceConfig?.practice_name || 'the practice',
        }
      ),
    ])

    session.crisisState = sonnetAssessment
    console.log(`🔍 Sonnet assessment: ${sonnetAssessment.level} → ${sonnetAssessment.recommendedAction}`)

    if (sonnetAssessment.recommendedAction === 'crisis_protocol') {
      // Sonnet says this is a real crisis — override Gemini's response
      const crisisResponse = getCrisisResponse(session.practiceConfig?.therapist_name || 'your therapist')
      sendText(ws, crisisResponse, true)
      session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${crisisResponse}`)
      alertTherapist(session, scan.matchedPhrases).catch(console.error)
      logCrisisAlert(session, scan.matchedPhrases).catch(console.error)
    } else if (sonnetAssessment.recommendedAction === 'gentle_checkin') {
      // Sonnet recommends a gentle check-in — use its suggested response or default
      const checkinResponse = getGentleCheckinResponse(
        session.practiceConfig?.therapist_name || 'your therapist',
        sonnetAssessment.sonnetAnalysis
      )
      sendText(ws, checkinResponse, true)
      session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${checkinResponse}`)
    } else if (sonnetAssessment.recommendedAction === 'escalate_therapist') {
      // Send Gemini's response but also quietly alert the therapist
      sendText(ws, geminiResponse, true)
      session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${geminiResponse}`)
      alertTherapist(session, scan.matchedPhrases).catch(console.error)
    } else {
      // False positive — just use Gemini's response
      sendText(ws, geminiResponse, true)
      session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${geminiResponse}`)
    }
    return
  }

  // ── Normal conversation — Gemini Flash only ──────────────────────────
  const response = await getGeminiResponse(session, utterance)
  streamToConversationRelay(ws, session, utterance, response)
}

function handleInterrupt(sessionId: string, message: any) {
  const session = sessions.get(sessionId)
  if (!session) return

  console.log(`🤚 Interrupted (${sessionId}): "${message.utteranceUntilInterrupt}"`)
  // We don't need to do anything special — ConversationRelay handles stopping TTS.
  // Just note it in the transcript for context.
  if (message.utteranceUntilInterrupt) {
    // Update the last assistant message to show what was actually heard
    const lastIdx = session.transcript.length - 1
    if (lastIdx >= 0 && session.transcript[lastIdx].startsWith(session.practiceConfig?.ai_name || 'Harbor')) {
      session.transcript[lastIdx] += ` [interrupted after: "${message.utteranceUntilInterrupt}"]`
    }
  }
}

async function handleDisconnect(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) return

  const duration = Math.round((Date.now() - session.startTime.getTime()) / 1000)
  console.log(`📴 Call ended: ${sessionId} (${duration}s)`)

  // Log the call to Supabase
  try {
    if (session.practiceId) {
      await supabase.from('call_logs').insert({
        practice_id: session.practiceId,
        patient_phone: session.callerPhone || 'unknown',
        transcript: session.transcript.join('\n'),
        duration_seconds: duration,
        summary: '', // Could generate with Sonnet post-call if needed
        crisis_detected: session.crisisState?.level === 'crisis',
      })
      console.log(`✓ Call logged to DB (${sessionId})`)
    }
  } catch (error) {
    console.error('Failed to log call:', error)
  }

  sessions.delete(sessionId)
}

// ── Gemini Flash integration ───────────────────────────────────────────────

async function getGeminiResponse(session: CallSession, utterance: string): Promise<string> {
  // Add user message to conversation history
  session.conversationHistory.push({
    role: 'user',
    parts: [{ text: utterance }],
  })

  try {
    const response = await genai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: session.conversationHistory,
      config: {
        maxOutputTokens: 200,  // Keep responses short for voice
        temperature: 0.7,      // Natural but not too creative
        topP: 0.9,
      },
    })

    const text = response.text || "I'm sorry, I didn't catch that. Could you say that again?"

    // Add assistant response to conversation history
    session.conversationHistory.push({
      role: 'model',
      parts: [{ text }],
    })

    return text
  } catch (error) {
    console.error('Gemini error:', error)
    return "I'm sorry, I'm having a brief technical issue. Could you repeat that?"
  }
}

// ── Send text to ConversationRelay ─────────────────────────────────────────

function sendText(ws: WebSocket, text: string, last: boolean = true) {
  if (ws.readyState !== WebSocket.OPEN) return

  // For ConversationRelay, send the full text as a single token
  // ConversationRelay handles the TTS chunking
  ws.send(JSON.stringify({
    type: 'text',
    token: text,
    last: true,
  }))
}

function streamToConversationRelay(
  ws: WebSocket,
  session: CallSession,
  utterance: string,
  response: string
) {
  sendText(ws, response, true)
  session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${response}`)
  console.log(`💬 ${session.practiceConfig?.ai_name || 'Harbor'}: "${response.substring(0, 80)}..."`)
}

// ── Crisis alerting ────────────────────────────────────────────────────────

async function alertTherapist(session: CallSession, phrases: string[]) {
  if (!session.practiceId) return

  try {
    // Get therapist's alert phone from practice settings
    const { data: practice } = await supabase
      .from('practices')
      .select('crisis_alert_phone, phone_number, provider_name')
      .eq('id', session.practiceId)
      .single()

    const alertPhone = practice?.crisis_alert_phone || practice?.phone_number
    if (!alertPhone || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      console.warn('Cannot send crisis alert — missing phone or Twilio config')
      return
    }

    const twilio = (await import('twilio')).default
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

    const callerLabel = session.callerPhone || 'Unknown number'
    const alertBody = [
      '🚨 HARBOR CRISIS ALERT',
      `Caller: ${callerLabel}`,
      `Detected: ${phrases.join(', ')}`,
      '',
      'A caller on your Harbor line may be in distress.',
      'Please review and follow up.',
      '',
      'If immediate danger: call 911',
      '988 Suicide & Crisis Lifeline: 988',
    ].join('\n')

    await client.messages.create({
      body: alertBody,
      from: TWILIO_PHONE_NUMBER,
      to: alertPhone.startsWith('+') ? alertPhone : `+1${alertPhone.replace(/\D/g, '')}`,
    })

    console.log(`🚨 Crisis alert sent to ${alertPhone}`)
  } catch (error) {
    console.error('Failed to send crisis alert:', error)
  }
}

async function logCrisisAlert(session: CallSession, phrases: string[]) {
  if (!session.practiceId) return

  try {
    await supabase.from('crisis_alerts').insert({
      practice_id: session.practiceId,
      caller_phone: session.callerPhone || null,
      transcript_snippet: session.transcript.slice(-6).join('\n').substring(0, 500),
      detected_phrases: phrases,
      alert_sent: true,
      created_at: new Date().toISOString(),
    })
  } catch (error) {
    console.warn('Failed to log crisis alert (table may not exist):', error)
  }
}

// ── Start server ───────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║          Harbor Voice Server 🏥                  ║
║                                                  ║
║  WebSocket:  ws://localhost:${PORT}/ws             ║
║  TwiML:      http://localhost:${PORT}/twiml        ║
║  Health:     http://localhost:${PORT}/health        ║
║                                                  ║
║  Gemini:     ${GEMINI_API_KEY ? '✓ configured' : '✗ MISSING'}                         ║
║  Supabase:   ${SUPABASE_URL ? '✓ configured' : '✗ MISSING'}                         ║
║  Twilio:     ${TWILIO_ACCOUNT_SID ? '✓ configured' : '✗ MISSING'}                         ║
╚══════════════════════════════════════════════════╝
  `)
})

export { app, server }
