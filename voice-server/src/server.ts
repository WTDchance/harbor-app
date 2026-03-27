// Harbor Voice Server
// Twilio ConversationRelay + Gemini 2.0 Flash (sub-200ms TTFB)
// Real-time voice AI receptionist with crisis detection

import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI } from '@google/genai'
import { buildVoiceSystemPrompt, PracticeConfig } from './system-prompt'
import {
  scanUtterance,
  analyzeWithSonnet,
  getCrisisResponse,
  getGentleCheckinResponse,
  CrisisAssessment,
} from './crisis-tripwire'

// ââ Environment ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const PORT = parseInt(process.env.PORT || '3001', 10)
const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || ''
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || ''

// ââ Clients ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY }) // kept for crisis detection (Sonnet)
const genai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null

// ââ Model selection ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Gemini 2.0 Flash: ~200ms TTFB, excellent for voice (fast + cheap)
// Falls back to Anthropic Haiku if no Gemini key
const useGemini = !!genai
const VOICE_MODEL = useGemini ? 'gemini-2.0-flash' : 'claude-haiku-4-5-20251001'
const PROVIDER = useGemini ? 'Gemini' : 'Anthropic'

// Startup check
;(async () => {
  if (useGemini) {
    console.log(`ð Gemini key present (${GEMINI_API_KEY.substring(0, 10)}...)`)
    try {
      const test = await genai!.models.generateContent({
        model: VOICE_MODEL,
        contents: 'Say "ok"',
        config: { maxOutputTokens: 10 },
      })
      console.log(`â Gemini Flash verified: "${test.text}"`)
    } catch (err: any) {
      console.error(`â Gemini API FAILED: ${err?.message?.substring(0, 200)}`)
    }
  } else if (ANTHROPIC_API_KEY) {
    console.log(`â ï¸  No GEMINI_API_KEY â falling back to Haiku (slower)`)
    try {
      const test = await anthropic.messages.create({
        model: VOICE_MODEL,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say "ok"' }],
      })
      const txt = test.content[0].type === 'text' ? test.content[0].text : '?'
      console.log(`â Haiku verified: "${txt}"`)
    } catch (err: any) {
      console.error(`â Haiku FAILED: ${err?.status} ${err?.message?.substring(0, 200)}`)
    }
  } else {
    console.error('â No LLM key! Set GEMINI_API_KEY (preferred) or ANTHROPIC_API_KEY.')
  }
})()

// ââ Connection pre-warming âââââââââââââââââââââââââââââââââââââââââââââââââ
let lastApiCallTime = Date.now()
const API_KEEPALIVE_MS = 4 * 60 * 1000

setInterval(async () => {
  if (Date.now() - lastApiCallTime > API_KEEPALIVE_MS) {
    try {
      if (useGemini) {
        await genai!.models.generateContent({
          model: VOICE_MODEL,
          contents: 'ok',
          config: { maxOutputTokens: 5 },
        })
      } else {
        await anthropic.messages.create({
          model: VOICE_MODEL,
          max_tokens: 5,
          messages: [{ role: 'user', content: 'ok' }],
        })
      }
      lastApiCallTime = Date.now()
    } catch (_) { /* ignore keepalive failures */ }
  }
}, API_KEEPALIVE_MS)

// ââ Practice cache âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
      console.log(`â Practice cache refreshed: ${data.length} practices`)
    }
    return practiceCache
  } catch (err) {
    console.warn('â ï¸  Practice cache refresh failed:', err)
    return practiceCache
  }
}

getCachedPractices().catch(console.error)

// ââ Session tracking âââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
const MAX_HISTORY = 8

// ââ Express app ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const app = express()
app.use(express.urlencoded({ extended: true }))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'harbor-voice-server',
    provider: PROVIDER,
    model: VOICE_MODEL,
    activeCalls: sessions.size,
    uptime: process.uptime(),
  })
})

app.post('/twiml', async (req, res) => {
  const callerNumber = req.body.From || 'unknown'
  const calledNumber = req.body.To || ''
  const callSid = req.body.CallSid || ''

  console.log(`ð Incoming call: ${callerNumber} â ${calledNumber} (${callSid})`)

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
        console.log(`â Personalized greeting for: ${practiceName}`)
      }
    }
  } catch (err) {
    console.warn('â ï¸  Greeting lookup failed:', err)
  }

  const greetingEscaped = welcomeGreeting
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const wsHost = process.env.VOICE_SERVER_HOST || req.headers.host || 'localhost:3001'
  const wsProtocol = process.env.NODE_ENV === 'production' ? 'wss' : 'ws'
  const wsUrl = `${wsProtocol}://${wsHost}/ws?callerPhone=${encodeURIComponent(callerNumber)}&calledNumber=${encodeURIComponent(calledNumber)}`

  const voiceId = ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'
  const voiceWithSettings = `${voiceId}-0.9_0.7_0.8`

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="${wsUrl.replace(/&/g, '&amp;')}"
      voice="${voiceWithSettings}"
      ttsProvider="ElevenLabs"
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

// ââ WebSocket ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', async (ws: WebSocket, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`)
  const callerPhone = url.searchParams.get('callerPhone') || null
  const calledNumber = url.searchParams.get('calledNumber') || null

  console.log(`ð WebSocket connected | caller: ${callerPhone}`)

  let sessionId = `temp-${Date.now()}`

  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping()
  }, 20000)

  ws.on('message', async (data) => {
    try {
      const raw = data.toString()
      const message = JSON.parse(raw)
      const preview = raw.length > 200 ? raw.substring(0, 200) + '...' : raw
      console.log(`ð¨ [${message.type}]: ${preview}`)

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
          console.log(`ð¢ DTMF: ${message.digit} (${sessionId})`)
          break
        default:
          console.log(`â Unknown: ${message.type}`)
      }
    } catch (error) {
      console.error('WS message error:', error)
    }
  })

  ws.on('close', () => {
    clearInterval(pingInterval); handleDisconnect(sessionId)
  })
  ws.on('error', (err) => {
    clearInterval(pingInterval); console.error(`WS error (${sessionId}):`, err)
  })
})

// ââ Handlers âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

async function handleSetup(
  ws: WebSocket,
  message: any,
  callerPhone: string | null,
  calledNumber: string | null
) {
  const callSid = message.callSid
  console.log(`ð Setup: ${callSid}`)

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
      const profile = match.onboarding_profile || {}
      practiceConfig = {
        therapist_name: match.provider_name || match.name || 'the therapist',
        practice_name: match.name || 'the practice',
        ai_name: match.ai_name || 'Harbor',
        therapist_title: match.therapist_title || profile.therapist_title || undefined,
        therapist_pronouns: match.therapist_pronouns || profile.therapist_pronouns || undefined,
        practice_vibe: match.practice_vibe || profile.practice_vibe || undefined,
        receptionist_personality: match.receptionist_personality || profile.receptionist_personality || undefined,
        specialties: match.specialties || profile.specialties || [],
        populations_served: match.populations_served || profile.populations_served || undefined,
        modalities: match.modalities || profile.modalities || undefined,
        languages: match.languages || profile.languages || undefined,
        hours: match.hours || match.office_hours || undefined,
        session_length_minutes: match.session_length_minutes || profile.session_length_minutes || undefined,
        booking_lead_days: match.booking_lead_days || profile.booking_lead_days || undefined,
        new_patient_callback_time: match.new_patient_callback_time || profile.new_patient_callback_time || undefined,
        evening_weekend_available: match.evening_weekend_available ?? profile.evening_weekend_available ?? false,
        intake_process_notes: match.intake_process_notes || profile.intake_process_notes || undefined,
        location: match.location || match.address || undefined,
        parking_notes: match.parking_notes || profile.parking_notes || undefined,
        telehealth: match.telehealth ?? match.telehealth_available ?? true,
        website: match.website || profile.website || undefined,
        insurance_accepted: match.insurance_accepted || [],
        sliding_scale: match.sliding_scale ?? profile.sliding_scale ?? false,
        cancellation_policy: match.cancellation_policy || profile.cancellation_policy || undefined,
        new_patients_accepted: match.accepting_new_patients ?? true,
        waitlist_enabled: match.waitlist_enabled ?? false,
        after_hours_emergency: match.after_hours_emergency || profile.after_hours_emergency || undefined,
        emotional_support_enabled: match.emotional_support_enabled ?? true,
        system_prompt_notes: match.system_prompt_notes || profile.system_prompt_notes || undefined,
        onboarding_profile: profile,
      }
      console.log(`â Practice: ${practiceConfig.practice_name}`)
    }
  }

  if (!practiceConfig) {
    practiceConfig = { therapist_name: 'the therapist', practice_name: 'the practice' }
  }

  const systemPrompt = buildVoiceSystemPrompt(practiceConfig)

  sessions.set(callSid, {
    callSid,
    practiceId,
    practiceConfig,
    systemPrompt,
    messages: [],
    transcript: [],
    callerPhone,
    crisisState: null,
    startTime: new Date(),
  })

  console.log(`ð§  Provider: ${PROVIDER} | Model: ${VOICE_MODEL} | prompt: ${systemPrompt.length} chars`)
}

async function handlePrompt(ws: WebSocket, message: any, sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) {
    console.warn(`No session: ${sessionId}`)
    sendText(ws, "I'm sorry, I'm having a technical issue. Could you please call back?")
    return
  }

  const utterance = message.voicePrompt || ''
  console.log(`ð£ï¸  Caller: "${utterance}" (${sessionId}) [${session.messages.length} msgs]`)

  if (ws.readyState !== WebSocket.OPEN) return

  session.transcript.push(`Caller: ${utterance}`)

  // ââ Crisis check âââââââââââââââââââââââââââââââââââââââââââââââââââââ
  const scan = scanUtterance(utterance)

  if (scan.immediateCrisis) {
    console.log(`ð¨ CRISIS: ${scan.matchedPhrases.join(', ')}`)
    const resp = getCrisisResponse(session.practiceConfig?.therapist_name || 'your therapist')
    sendText(ws, resp)
    session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${resp}`)
    session.crisisState = {
      level: 'crisis',
      immediate: true,
      triggerPhrases: scan.matchedPhrases,
      recommendedAction: 'crisis_protocol',
    }
    alertTherapist(session, scan.matchedPhrases).catch(console.error)
    logCrisisAlert(session, scan.matchedPhrases).catch(console.error)
    return
  }

  if (scan.tripwireTriggered) {
    console.log(`â ï¸  Tripwire: ${scan.matchedPhrases.join(', ')}`)

    const [llmResp, assessment] = await Promise.all([
      getLLMResponse(session, utterance),
      analyzeWithSonnet(
        session.transcript.join('\n'),
        scan.matchedPhrases,
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

  // ââ Normal conversation (streamed for lowest latency) âââââââââââââ
  try {
    const response = await streamLLMResponse(ws, session, utterance)
    session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${response}`)
    console.log(`ð¬ ${session.practiceConfig?.ai_name || 'Harbor'}: "${response.substring(0, 100)}..."`)
  } catch (err) {
    console.error('LLM error:', err)
    sendText(ws, "I'm sorry, I'm having a brief technical issue. Could you repeat that?")
  }
}

function handleInterrupt(sessionId: string, message: any) {
  const session = sessions.get(sessionId)
  if (!session) return
  console.log(`ð¤ Interrupted (${sessionId})`)
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
  console.log(`ð´ Call ended: ${sessionId} (${duration}s)`)

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
      console.log(`â Call logged`)
    }
  } catch (error) {
    console.error('Failed to log call:', error)
  }

  sessions.delete(sessionId)
}

// ââ Gemini / Anthropic LLM helpers âââââââââââââââââââââââââââââââââââââââââ

// Convert our message format to Gemini's content format
function toGeminiContents(messages: Array<{ role: string; content: string }>) {
  return messages.map(m => ({
    role: m.role === 'assistant' ? 'model' as const : 'user' as const,
    parts: [{ text: m.content }],
  }))
}

// ââ LLM streaming (primary path for all normal conversation) ââââââââââââââ
// Gemini Flash: ~200ms TTFB â 2x faster than Haiku
// Streams tokens to ConversationRelay so TTS starts immediately

async function streamLLMResponse(ws: WebSocket, session: CallSession, utterance: string): Promise<string> {
  session.messages.push({ role: 'user', content: utterance })
  const trimmed = session.messages.slice(-MAX_HISTORY)
  const t0 = Date.now()
  let firstTokenTime = 0
  let fullText = ''

  try {
    if (useGemini && genai) {
      // ââ Gemini Flash streaming path âââââââââââââââââââââââââââââââââ
      const stream = await genai.models.generateContentStream({
        model: VOICE_MODEL,
        contents: toGeminiContents(trimmed),
        config: {
          systemInstruction: session.systemPrompt,
          maxOutputTokens: 150,
          temperature: 0.7,
        },
      })

      for await (const chunk of stream) {
        const text = chunk.text || ''
        if (text) {
          if (!firstTokenTime) firstTokenTime = Date.now()
          fullText += text
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'text', token: text, last: false }))
          }
        }
      }
    } else {
      // ââ Anthropic Haiku fallback ââââââââââââââââââââââââââââââââââââââ
      const stream = anthropic.messages.stream({
        model: VOICE_MODEL,
        max_tokens: 150,
        system: [
          {
            type: 'text' as const,
            text: session.systemPrompt,
            cache_control: { type: 'ephemeral' as const },
          },
        ],
        messages: trimmed,
      })

      stream.on('text', (text) => {
        if (!firstTokenTime) firstTokenTime = Date.now()
        fullText += text
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'text', token: text, last: false }))
        }
      })

      await stream.finalMessage()
    }

    // Signal end of response
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'text', token: '', last: true }))
    }

    const totalMs = Date.now() - t0
    const ttfb = firstTokenTime ? firstTokenTime - t0 : totalMs
    lastApiCallTime = Date.now()

    console.log(`â¡ ${PROVIDER} stream: TTFB=${ttfb}ms total=${totalMs}ms | len=${fullText.length} | history=${trimmed.length}`)

    session.messages.push({ role: 'assistant', content: fullText })
    return fullText

  } catch (error: any) {
    const latency = Date.now() - t0
    console.error(`â ${PROVIDER} stream error (${latency}ms):`, error?.message?.substring(0, 200) || error)

    if (fullText && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'text', token: '', last: true }))
      session.messages.push({ role: 'assistant', content: fullText })
      return fullText
    }

    session.messages.pop()
    return "I'm sorry, I'm having a brief technical issue. Could you repeat that?"
  }
}

// Non-streaming fallback (used for crisis tripwire where we need full text before deciding)
async function getLLMResponse(session: CallSession, utterance: string): Promise<string> {
  session.messages.push({ role: 'user', content: utterance })
  const trimmed = session.messages.slice(-MAX_HISTORY)
  const t0 = Date.now()

  try {
    let text: string

    if (useGemini && genai) {
      const response = await genai.models.generateContent({
        model: VOICE_MODEL,
        contents: toGeminiContents(trimmed),
        config: {
          systemInstruction: session.systemPrompt,
          maxOutputTokens: 150,
          temperature: 0.7,
        },
      })
      text = response.text || "I'm sorry, I didn't catch that. Could you say that again?"
    } else {
      const response = await anthropic.messages.create({
        model: VOICE_MODEL,
        max_tokens: 150,
        system: [
          {
            type: 'text' as const,
            text: session.systemPrompt,
            cache_control: { type: 'ephemeral' as const },
          },
        ],
        messages: trimmed,
      })
      text = response.content[0].type === 'text'
        ? response.content[0].text
        : "I'm sorry, I didn't catch that. Could you say that again?"
    }

    const latency = Date.now() - t0
    console.log(`â¡ ${PROVIDER} in ${latency}ms | len=${text.length} | history=${trimmed.length}`)
    session.messages.push({ role: 'assistant', content: text })
    return text

  } catch (error: any) {
    const latency = Date.now() - t0
    console.error(`â ${PROVIDER} error (${latency}ms):`, error?.message?.substring(0, 200) || error)
    session.messages.pop()
    return "I'm sorry, I'm having a brief technical issue. Could you repeat that?"
  }
}

// ââ Send to ConversationRelay ââââââââââââââââââââââââââââââââââââââââââââââ
function sendText(ws: WebSocket, text: string) {
  if (ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'text', token: text, last: true }))
}

// ââ Crisis alerting ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
        'ð¨ HARBOR CRISIS ALERT',
        `Caller: ${session.callerPhone || 'Unknown'}`,
        `Detected: ${phrases.join(', ')}`,
        '',
        'A caller may be in distress. Please review.',
        '',
        'If immediate danger: call 911',
        '988 Suicide & Crisis Lifeline: 988',
      ].join('\n'),
      from: TWILIO_PHONE_NUMBER,
      to: alertPhone.startsWith('+') ? alertPhone : `+1${alertPhone.replace(/\D/g, '')}`,
    })

    console.log(`ð¨ Crisis alert sent to ${alertPhone}`)
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

// ââ Start ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
server.listen(PORT, () => {
  console.log(`
ââââââââââââââââââââââââââââââââââââââââââââââââââââ
â            Harbor Voice Server                   â
â                                                  â
â  Provider:  ${(PROVIDER + '                    ').slice(0, 20)}â
â  Model:     ${(VOICE_MODEL + '                    ').slice(0, 20)}â
â  WS:        ws://localhost:${PORT}/ws              â
â  TwiML:     http://localhost:${PORT}/twiml         â
â                                                  â
â  Gemini:    ${GEMINI_API_KEY ? 'â' : 'â'}                                 â
â  Anthropic: ${ANTHROPIC_API_KEY ? 'â' : 'â'} (crisis detection)          â
â  Supabase:  ${SUPABASE_URL ? 'â' : 'â'}                                 â
â  Twilio:    ${TWILIO_ACCOUNT_SID ? 'â' : 'â'}                                 â
â  Voice:     ElevenLabs Flash 2.5                 â
ââââââââââââââââââââââââââââââââââââââââââââââââââââ
  `)
})

export { app, server }
