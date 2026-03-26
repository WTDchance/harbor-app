// Harbor Voice Server
// Standalone WebSocket server for Twilio ConversationRelay + Gemini
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

// ── Practice cache (avoid DB hit on every call) ───────────────────────────
let practiceCache: any[] = []
let practiceCacheTime = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

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
    console.warn('⚠️ Practice cache refresh failed, using stale cache:', err)
    return practiceCache
  }
}

// Pre-load cache on startup
getCachedPractices().catch(console.error)

// ── Model auto-detection at startup ──────────────────────────────────────
// Try gemini-2.0-flash-lite first (non-thinking, fastest).
// If unavailable (404), fall back to gemini-2.5-flash-lite.
let activeModel = 'gemini-2.0-flash-lite' // optimistic default

async function detectBestModel() {
  try {
    const response = await genai.models.generateContent({
      model: 'gemini-2.0-flash-lite',
      contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
      config: { maxOutputTokens: 5 },
    })
    if (response.text) {
      activeModel = 'gemini-2.0-flash-lite'
      console.log('🧠 Model: gemini-2.0-flash-lite (non-thinking, fastest)')
      return
    }
  } catch (err: any) {
    console.log(`ℹ️ gemini-2.0-flash-lite not available: ${err?.message?.substring(0, 80)}`)
  }

  // Try gemini-2.0-flash
  try {
    const response = await genai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
      config: { maxOutputTokens: 5 },
    })
    if (response.text) {
      activeModel = 'gemini-2.0-flash'
      console.log('🧠 Model: gemini-2.0-flash (non-thinking)')
      return
    }
  } catch (err: any) {
    console.log(`ℹ️ gemini-2.0-flash not available: ${err?.message?.substring(0, 80)}`)
  }

  // Fall back to 2.5-flash-lite with thinking disabled
  activeModel = 'gemini-2.5-flash-lite'
  console.log('🧠 Model: gemini-2.5-flash-lite (thinking disabled)')
}

// Run model detection at startup (non-blocking)
detectBestModel().catch(console.error)

// ── Session tracking ───────────────────────────────────────────────────────
interface CallSession {
  callSid: string
  practiceId: string | null
  practiceConfig: PracticeConfig | null
  systemPrompt: string
  conversationHistory: Array<{ role: 'user' | 'model'; parts: [{ text: string }] }>
  transcript: string[]
  callerPhone: string | null
  crisisState: CrisisAssessment | null
  startTime: Date
}

const sessions = new Map<string, CallSession>()

// Max conversation turns to keep (6 user+model pairs = 12 messages)
const MAX_HISTORY_TURNS = 12

// ── Express app ────────────────────────────────────────────────────────────
const app = express()
app.use(express.urlencoded({ extended: true }))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'harbor-voice-server',
    model: activeModel,
    activeCalls: sessions.size,
    uptime: process.uptime(),
  })
})

// TwiML endpoint — Twilio calls this when a voice call comes in.
app.post('/twiml', async (req, res) => {
  const callerNumber = req.body.From || 'unknown'
  const calledNumber = req.body.To || ''
  const callSid = req.body.CallSid || ''

  console.log(`📞 Incoming call: ${callerNumber} → ${calledNumber} (${callSid})`)

  // Fast practice lookup from cache
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
    console.warn('⚠️ Could not look up practice for greeting:', err)
  }

  const greetingEscaped = welcomeGreeting
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const wsHost = process.env.VOICE_SERVER_HOST || req.headers.host || 'localhost:3001'
  const wsProtocol = process.env.NODE_ENV === 'production' ? 'wss' : 'ws'
  const wsUrl = `${wsProtocol}://${wsHost}/ws?callerPhone=${encodeURIComponent(callerNumber)}&calledNumber=${encodeURIComponent(calledNumber)}`
  const wsUrlEscaped = wsUrl.replace(/&/g, '&amp;')

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

  let sessionId = `temp-${Date.now()}`

  // Keep WebSocket alive — ping every 20s
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping()
  }, 20000)

  ws.on('message', async (data) => {
    try {
      const raw = data.toString()
      const message = JSON.parse(raw)
      const logPreview = raw.length > 200 ? raw.substring(0, 200) + '...' : raw
      console.log(`📨 WS msg [${message.type || 'no-type'}]: ${logPreview}`)

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
          console.log(`❓ Unknown: ${message.type}`, JSON.stringify(message).substring(0, 300))
      }
    } catch (error) {
      console.error('WebSocket message error:', error)
      console.error('Raw data:', data.toString().substring(0, 500))
    }
  })

  ws.on('close', () => { clearInterval(pingInterval); handleDisconnect(sessionId) })
  ws.on('error', (error) => { clearInterval(pingInterval); console.error(`WS error (${sessionId}):`, error) })
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

  let practiceId: string | null = null
  let practiceConfig: PracticeConfig | null = null

  if (calledNumber) {
    const digits = calledNumber.replace(/\D/g, '').slice(-10)
    const practices = await getCachedPractices()
    if (practices.length > 0) {
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
    console.warn('⚠️ No practice match — using defaults')
    practiceConfig = { therapist_name: 'the therapist', practice_name: 'the practice' }
  }

  const systemPrompt = buildVoiceSystemPrompt(practiceConfig)

  const session: CallSession = {
    callSid,
    practiceId,
    practiceConfig,
    systemPrompt,
    conversationHistory: [],
    transcript: [],
    callerPhone,
    crisisState: null,
    startTime: new Date(),
  }
  console.log(`🧠 Using model: ${activeModel} | prompt: ${systemPrompt.length} chars`)

  sessions.set(callSid, session)
}

async function handlePrompt(ws: WebSocket, message: any, sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) {
    console.warn(`No session for ${sessionId}`)
    sendText(ws, "I'm sorry, I'm having a technical issue. Could you please call back?")
    return
  }

  const utterance = message.voicePrompt || ''
  console.log(`🗣️ Caller: "${utterance}" (${sessionId}) [history: ${session.conversationHistory.length} msgs]`)

  if (ws.readyState !== WebSocket.OPEN) {
    console.warn(`⚠️ WS closed before prompt (${sessionId})`)
    return
  }

  session.transcript.push(`Caller: ${utterance}`)

  // ── Crisis tripwire ──────────────────────────────────────────────────
  const scan = scanUtterance(utterance)

  if (scan.immediateCrisis) {
    console.log(`🚨 CRISIS: ${scan.matchedPhrases.join(', ')} (${sessionId})`)
    const crisisResponse = getCrisisResponse(session.practiceConfig?.therapist_name || 'your therapist')
    sendText(ws, crisisResponse)
    session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${crisisResponse}`)
    session.crisisState = {
      level: 'crisis', immediate: true,
      triggerPhrases: scan.matchedPhrases, recommendedAction: 'crisis_protocol',
    }
    alertTherapist(session, scan.matchedPhrases).catch(console.error)
    logCrisisAlert(session, scan.matchedPhrases).catch(console.error)
    return
  }

  if (scan.tripwireTriggered) {
    console.log(`⚠️ Tripwire: ${scan.matchedPhrases.join(', ')} (${sessionId})`)
    const [llmResponse, sonnetAssessment] = await Promise.all([
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
    console.log(`🔍 Sonnet: ${sonnetAssessment.level} → ${sonnetAssessment.recommendedAction}`)

    if (sonnetAssessment.recommendedAction === 'crisis_protocol') {
      const crisisResponse = getCrisisResponse(session.practiceConfig?.therapist_name || 'your therapist')
      sendText(ws, crisisResponse)
      session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${crisisResponse}`)
      alertTherapist(session, scan.matchedPhrases).catch(console.error)
      logCrisisAlert(session, scan.matchedPhrases).catch(console.error)
    } else if (sonnetAssessment.recommendedAction === 'gentle_checkin') {
      const checkinResponse = getGentleCheckinResponse(
        session.practiceConfig?.therapist_name || 'your therapist',
        sonnetAssessment.sonnetAnalysis
      )
      sendText(ws, checkinResponse)
      session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${checkinResponse}`)
    } else {
      sendText(ws, llmResponse)
      session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${llmResponse}`)
      if (sonnetAssessment.recommendedAction === 'escalate_therapist') {
        alertTherapist(session, scan.matchedPhrases).catch(console.error)
      }
    }
    return
  }

  // ── Normal conversation ────────────────────────────────────────────────
  try {
    const response = await getGeminiResponse(session, utterance)
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
  console.log(`🤚 Interrupted (${sessionId}): "${message.utteranceUntilInterrupt}"`)
  if (message.utteranceUntilInterrupt) {
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
      console.log(`✓ Call logged (${sessionId})`)
    }
  } catch (error) {
    console.error('Failed to log call:', error)
  }

  sessions.delete(sessionId)
}

// ── Gemini LLM ──────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (val) => { clearTimeout(timer); resolve(val) },
      (err) => { clearTimeout(timer); reject(err) }
    )
  })
}

async function getGeminiResponse(session: CallSession, utterance: string): Promise<string> {
  session.conversationHistory.push({ role: 'user', parts: [{ text: utterance }] })

  const trimmedHistory = session.conversationHistory.slice(-MAX_HISTORY_TURNS)

  // Build config based on model — non-thinking models don't need thinkingConfig
  const isThinkingModel = activeModel.includes('2.5')
  const config: any = {
    systemInstruction: session.systemPrompt,
    maxOutputTokens: 150,
    temperature: 0.6,
    topP: 0.85,
  }
  if (isThinkingModel) {
    config.thinkingConfig = { thinkingBudget: 0 }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const t0 = Date.now()
      const response = await withTimeout(
        genai.models.generateContent({
          model: activeModel,
          contents: trimmedHistory,
          config,
        }),
        10000,
        `Gemini ${activeModel}`
      )
      const latency = Date.now() - t0
      const rawText = response.text
      const text = rawText || "I'm sorry, I didn't catch that. Could you say that again?"
      console.log(`⚡ ${activeModel} in ${latency}ms | len=${text.length} | history=${trimmedHistory.length}`)

      session.conversationHistory.push({ role: 'model', parts: [{ text }] })
      return text
    } catch (error: any) {
      console.error(`Gemini error (attempt ${attempt + 1}, ${activeModel}):`, error?.message?.substring(0, 120) || error)

      // If current model 404s, switch to fallback
      if (error?.message?.includes('404') || error?.message?.includes('not found')) {
        if (activeModel === 'gemini-2.0-flash-lite') {
          activeModel = 'gemini-2.0-flash'
          console.log('🔄 Switching to gemini-2.0-flash')
        } else if (activeModel === 'gemini-2.0-flash') {
          activeModel = 'gemini-2.5-flash-lite'
          console.log('🔄 Switching to gemini-2.5-flash-lite (with thinkingBudget:0)')
        }
        continue
      }

      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 300))
      }
    }
  }

  session.conversationHistory.pop()
  return "I'm sorry, I'm having a brief technical issue. Could you repeat that?"
}

// ── Send text to ConversationRelay ─────────────────────────────────────────

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
    if (!alertPhone || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      console.warn('Cannot send crisis alert — missing config')
      return
    }

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
    console.warn('Failed to log crisis alert:', error)
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
║  Model:      ${activeModel.padEnd(35)}║
║  Gemini:     ${GEMINI_API_KEY ? '✓ configured' : '✗ MISSING'}                         ║
║  Supabase:   ${SUPABASE_URL ? '✓ configured' : '✗ MISSING'}                         ║
║  Twilio:     ${TWILIO_ACCOUNT_SID ? '✓ configured' : '✗ MISSING'}                         ║
╚══════════════════════════════════════════════════╝
  `)
})

export { app, server }
