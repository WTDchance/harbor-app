// Harbor Voice Server
// Twilio ConversationRelay + Claude Haiku (fast, HIPAA-eligible)
// Real-time voice AI receptionist with crisis detection

import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
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
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || ''

// ── Clients ────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

// Voice model — Claude 3.5 Haiku: fast (~300-500ms), cheap, great at conversation
const VOICE_MODEL = 'claude-3-5-haiku-20241022'

// ── Practice cache ─────────────────────────────────────────────────────────
let practiceCache: any[] = []
let practiceCacheTime = 0
const CACHE_TTL = 5 * 60 * 1000

async function getCachedPractices(): Promise<any[]> {
  const now = Date.now()
  if (practiceCache.length > 0 && now - practiceCacheTime < CACHE_TTL) {
    return practiceCache
  }
  try {
    const { data } = await supabase.from('practices').select('*')
    if (data && data.length > 0) {
      practiceCache = data
      practiceCacheTime = now
      console.log(`✓ Practice cache refreshed: ${data.length} practices`)
    }
    return practiceCache
  } catch (err) {
    console.warn('⚠️ Practice cache refresh failed:', err)
    return practiceCache
  }
}

getCachedPractices().catch(console.error)

// ── Session tracking ───────────────────────────────────────────────────────
interface CallSession {
  callSid: string
  practiceId: string | null
  practiceConfig: PracticeConfig | null
  systemPrompt: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  transcript: string[]
  callerPhone: string | null
  crisisState: CrisisAssessment | null
  startTime: Date
}

const sessions = new Map<string, CallSession>()
const MAX_HISTORY = 12 // last 6 exchanges

// ── Express app ────────────────────────────────────────────────────────────
const app = express()
app.use(express.urlencoded({ extended: true }))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'harbor-voice-server',
    model: VOICE_MODEL,
    activeCalls: sessions.size,
    uptime: process.uptime(),
  })
})

app.post('/twiml', async (req, res) => {
  const callerNumber = req.body.From || 'unknown'
  const calledNumber = req.body.To || ''
  const callSid = req.body.CallSid || ''

  console.log(`📞 Incoming call: ${callerNumber} → ${calledNumber} (${callSid})`)

  let welcomeGreeting = 'Thank you for calling, how can I help you today?'
  try {
    if (calledNumber) {
      const digits = calledNumber.replace(/\D/g, '').slice(-10)
      const practices = await getCachedPractices()
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
  } catch (err) {
    console.warn('⚠️ Greeting lookup failed:', err)
  }

  const greetingEscaped = welcomeGreeting
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const wsHost = process.env.VOICE_SERVER_HOST || req.headers.host || 'localhost:3001'
  const wsProtocol = process.env.NODE_ENV === 'production' ? 'wss' : 'ws'
  const wsUrl = `${wsProtocol}://${wsHost}/ws?callerPhone=${encodeURIComponent(callerNumber)}&calledNumber=${encodeURIComponent(calledNumber)}`

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="${wsUrl.replace(/&/g, '&amp;')}"
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

// ── WebSocket ──────────────────────────────────────────────────────────────
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', async (ws: WebSocket, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`)
  const callerPhone = url.searchParams.get('callerPhone') || null
  const calledNumber = url.searchParams.get('calledNumber') || null

  console.log(`🔌 WebSocket connected | caller: ${callerPhone}`)

  let sessionId = `temp-${Date.now()}`
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping()
  }, 20000)

  ws.on('message', async (data) => {
    try {
      const raw = data.toString()
      const message = JSON.parse(raw)
      const preview = raw.length > 200 ? raw.substring(0, 200) + '...' : raw
      console.log(`📨 [${message.type}]: ${preview}`)

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
          console.log(`🔢 DTMF: ${message.digit} (${sessionId})`)
          break
        default:
          console.log(`❓ Unknown: ${message.type}`)
      }
    } catch (error) {
      console.error('WS message error:', error)
    }
  })

  ws.on('close', () => { clearInterval(pingInterval); handleDisconnect(sessionId) })
  ws.on('error', (err) => { clearInterval(pingInterval); console.error(`WS error (${sessionId}):`, err) })
})

// ── Handlers ───────────────────────────────────────────────────────────────

async function handleSetup(
  ws: WebSocket, message: any,
  callerPhone: string | null, calledNumber: string | null
) {
  const callSid = message.callSid
  console.log(`📋 Setup: ${callSid}`)

  let practiceId: string | null = null
  let practiceConfig: PracticeConfig | null = null

  if (calledNumber) {
    const digits = calledNumber.replace(/\D/g, '').slice(-10)
    const practices = await getCachedPractices()
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
      console.log(`✓ Practice: ${practiceConfig.practice_name}`)
    }
  }

  if (!practiceConfig) {
    practiceConfig = { therapist_name: 'the therapist', practice_name: 'the practice' }
  }

  const systemPrompt = buildVoiceSystemPrompt(practiceConfig)

  sessions.set(callSid, {
    callSid, practiceId, practiceConfig, systemPrompt,
    messages: [],
    transcript: [],
    callerPhone,
    crisisState: null,
    startTime: new Date(),
  })
  console.log(`🧠 Model: ${VOICE_MODEL} | prompt: ${systemPrompt.length} chars`)
}

async function handlePrompt(ws: WebSocket, message: any, sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) {
    console.warn(`No session: ${sessionId}`)
    sendText(ws, "I'm sorry, I'm having a technical issue. Could you please call back?")
    return
  }

  const utterance = message.voicePrompt || ''
  console.log(`🗣️ Caller: "${utterance}" (${sessionId}) [${session.messages.length} msgs]`)

  if (ws.readyState !== WebSocket.OPEN) return

  session.transcript.push(`Caller: ${utterance}`)

  // ── Crisis check ─────────────────────────────────────────────────────
  const scan = scanUtterance(utterance)

  if (scan.immediateCrisis) {
    console.log(`🚨 CRISIS: ${scan.matchedPhrases.join(', ')}`)
    const resp = getCrisisResponse(session.practiceConfig?.therapist_name || 'your therapist')
    sendText(ws, resp)
    session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${resp}`)
    session.crisisState = {
      level: 'crisis', immediate: true,
      triggerPhrases: scan.matchedPhrases, recommendedAction: 'crisis_protocol',
    }
    alertTherapist(session, scan.matchedPhrases).catch(console.error)
    logCrisisAlert(session, scan.matchedPhrases).catch(console.error)
    return
  }

  if (scan.tripwireTriggered) {
    console.log(`⚠️ Tripwire: ${scan.matchedPhrases.join(', ')}`)
    const [llmResp, assessment] = await Promise.all([
      getLLMResponse(session, utterance),
      analyzeWithSonnet(
        session.transcript.join('\n'), scan.matchedPhrases,
        {
          therapistName: session.practiceConfig?.therapist_name || 'the therapist',
          practiceName: session.practiceConfig?.practice_name || 'the practice',
        }
      ),
    ])
    session.crisisState = assessment

    if (assessment.recommendedAction === 'crisis_protocol') {
      const resp = getCrisisResponse(session.practiceConfig?.therapist_name || 'your therapist')
      sendText(ws, resp)
      session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${resp}`)
      alertTherapist(session, scan.matchedPhrases).catch(console.error)
      logCrisisAlert(session, scan.matchedPhrases).catch(console.error)
    } else if (assessment.recommendedAction === 'gentle_checkin') {
      const resp = getGentleCheckinResponse(
        session.practiceConfig?.therapist_name || 'your therapist',
        assessment.sonnetAnalysis
      )
      sendText(ws, resp)
      session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${resp}`)
    } else {
      sendText(ws, llmResp)
      session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${llmResp}`)
      if (assessment.recommendedAction === 'escalate_therapist') {
        alertTherapist(session, scan.matchedPhrases).catch(console.error)
      }
    }
    return
  }

  // ── Normal conversation ────────────────────────────────────────────
  try {
    const response = await getLLMResponse(session, utterance)
    sendText(ws, response)
    session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${response}`)
    console.log(`💬 ${session.practiceConfig?.ai_name || 'Harbor'}: "${response.substring(0, 100)}..."`)
  } catch (err) {
    console.error('LLM error:', err)
    sendText(ws, "I'm sorry, I'm having a brief technical issue. Could you repeat that?")
  }
}

function handleInterrupt(sessionId: string, message: any) {
  const session = sessions.get(sessionId)
  if (!session) return
  console.log(`🤚 Interrupted (${sessionId})`)
  if (message.utteranceUntilInterrupt) {
    const last = session.transcript.length - 1
    if (last >= 0 && session.transcript[last].startsWith(session.practiceConfig?.ai_name || 'Harbor')) {
      session.transcript[last] += ` [interrupted]`
    }
  }
}

async function handleDisconnect(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) return
  const duration = Math.round((Date.now() - session.startTime.getTime()) / 1000)
  console.log(`📴 Call ended: ${sessionId} (${duration}s)`)

  try {
    if (session.practiceId) {
      await supabase.from('call_logs').insert({
        practice_id: session.practiceId,
        patient_phone: session.callerPhone || 'unknown',
        transcript: session.transcript.join('\n'),
        duration_seconds: duration,
        summary: '',
        crisis_detected: session.crisisState?.level === 'crisis',
      })
      console.log(`✓ Call logged`)
    }
  } catch (error) {
    console.error('Failed to log call:', error)
  }
  sessions.delete(sessionId)
}

// ── Claude Haiku LLM ───────────────────────────────────────────────────────

async function getLLMResponse(session: CallSession, utterance: string): Promise<string> {
  // Add to history
  session.messages.push({ role: 'user', content: utterance })

  // Trim to last N messages for speed
  const trimmed = session.messages.slice(-MAX_HISTORY)

  const t0 = Date.now()
  try {
    const response = await anthropic.messages.create({
      model: VOICE_MODEL,
      max_tokens: 150,
      system: session.systemPrompt,
      messages: trimmed,
    })

    const latency = Date.now() - t0
    const text = response.content[0].type === 'text'
      ? response.content[0].text
      : "I'm sorry, I didn't catch that. Could you say that again?"

    console.log(`⚡ Haiku in ${latency}ms | len=${text.length} | history=${trimmed.length}`)

    session.messages.push({ role: 'assistant', content: text })
    return text
  } catch (error: any) {
    const latency = Date.now() - t0
    console.error(`Haiku error (${latency}ms):`, error?.message?.substring(0, 120) || error)

    // Remove user message on failure
    session.messages.pop()
    return "I'm sorry, I'm having a brief technical issue. Could you repeat that?"
  }
}

// ── Send to ConversationRelay ──────────────────────────────────────────────

function sendText(ws: WebSocket, text: string) {
  if (ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'text', token: text, last: true }))
}

// ── Crisis alerting ────────────────────────────────────────────────────────

async function alertTherapist(session: CallSession, phrases: string[]) {
  if (!session.practiceId) return
  try {
    const { data: practice } = await supabase
      .from('practices')
      .select('crisis_alert_phone, phone_number, provider_name')
      .eq('id', session.practiceId)
      .single()

    const alertPhone = practice?.crisis_alert_phone || practice?.phone_number
    if (!alertPhone || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) return

    const twilio = (await import('twilio')).default
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

    await client.messages.create({
      body: [
        '🚨 HARBOR CRISIS ALERT',
        `Caller: ${session.callerPhone || 'Unknown'}`,
        `Detected: ${phrases.join(', ')}`,
        '', 'A caller may be in distress. Please review.',
        '', 'If immediate danger: call 911',
        '988 Suicide & Crisis Lifeline: 988',
      ].join('\n'),
      from: TWILIO_PHONE_NUMBER,
      to: alertPhone.startsWith('+') ? alertPhone : `+1${alertPhone.replace(/\D/g, '')}`,
    })
    console.log(`🚨 Crisis alert sent to ${alertPhone}`)
  } catch (error) {
    console.error('Crisis alert failed:', error)
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
    console.warn('Crisis log failed:', error)
  }
}

// ── Start ──────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║          Harbor Voice Server 🏥                  ║
║                                                  ║
║  Model:    ${VOICE_MODEL}          ║
║  WS:       ws://localhost:${PORT}/ws               ║
║  TwiML:    http://localhost:${PORT}/twiml          ║
║                                                  ║
║  Anthropic: ${ANTHROPIC_API_KEY ? '✓' : '✗'}                                    ║
║  Supabase:  ${SUPABASE_URL ? '✓' : '✗'}                                    ║
║  Twilio:    ${TWILIO_ACCOUNT_SID ? '✓' : '✗'}                                    ║
╚══════════════════════════════════════════════════╝
  `)
})

export { app, server }
