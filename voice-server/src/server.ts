// Harbor Voice Server
// Twilio ConversationRelay + Gemini 2.5 Flash
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

// ━━━━━ Environment ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const PORT = parseInt(process.env.PORT || '3001', 10)
const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || ''
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || ''

// ━━━━━ Clients ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY }) // kept for crisis detection (Sonnet)
const genai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null

// ━━━━━ Model selection ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Gemini 2.5 Flash: ~200ms TTFB, excellent for voice (fast + cheap)
// Falls back to Anthropic Haiku if no Gemini key
const useGemini = !!genai
const VOICE_MODEL = useGemini ? 'gemini-2.5-flash' : 'claude-haiku-4-5-20251001'
const PROVIDER = useGemini ? 'Gemini' : 'Anthropic'

// Helper to safely extract text from Gemini generateContent responses
// The .text property can be undefined depending on SDK version/response format
function getGeminiText(result: any): string {
  // 1. Try convenience .text property (some SDK versions)
  if (typeof result?.text === 'string' && result.text.length > 0) return result.text
  // 2. Try .text() as method
  if (typeof result?.text === 'function') {
    try { const t = result.text(); if (t) return t } catch(e) { /* continue */ }
  }
  // 3. Try candidates path
  const candidate = result?.candidates?.[0]
  if (candidate) {
    const parts = candidate?.content?.parts
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (typeof part?.text === 'string') return part.text
      }
    }
    if (typeof candidate?.text === 'string') return candidate.text
    console.warn('Candidate keys:', Object.keys(candidate || {}))
    if (candidate?.content) console.warn('  content keys:', Object.keys(candidate.content || {}))
    if (Array.isArray(parts)) console.warn('  parts[0]:', JSON.stringify(parts[0])?.substring(0, 200))
  }
  // 4. Deep search - find text in serialized response
  try {
    const json = JSON.stringify(result)
    const textMatch = json?.match(/"text":"([^"]*)"/)
    if (textMatch && textMatch[1]) {
      console.log('  Found text via JSON search:', textMatch[1].substring(0, 100))
      return textMatch[1]
    }
  } catch(e) { /* ignore */ }
  console.warn('No text in Gemini response. Keys:', Object.keys(result || {}).join(', '))
  return ''
}

// Startup check
;(async () => {
  if (useGemini) {
    console.log(`🔑 Gemini key present (${GEMINI_API_KEY.substring(0, 10)}...)`)
    try {
      const test = await genai!.models.generateContent({
        model: VOICE_MODEL,
        contents: 'Say "ok"',
        config: { maxOutputTokens: 10 },
      })
      const verifiedText = getGeminiText(test)
      console.log(`✓ Gemini Flash verified: "${verifiedText}"`)
      console.log(`  Response .text type: ${typeof test?.text}, keys: ${Object.keys(test || {}).join(', ')}`)
      console.log(`  Candidates[0]: ${JSON.stringify(test?.candidates?.[0])?.substring(0, 500)}`)
    } catch (err: any) {
      console.error(`✗ Gemini API FAILED: ${err?.message?.substring(0, 200)}`)
    }
  } else if (ANTHROPIC_API_KEY) {
    console.log(`✓ ⚠️  No GEMINI_API_KEY → falling back to Haiku (slower)`)
    try {
      const test = await anthropic.messages.create({
        model: VOICE_MODEL,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say "ok"' }],
      })
      const txt = test.content[0].type === 'text' ? test.content[0].text : '?'
      console.log(`✓ Haiku verified: "${txt}"`)
    } catch (err: any) {
      console.error(`✗ Haiku FAILED: ${err?.status} ${err?.message?.substring(0, 200)}`)
    }
  } else {
    console.error('✗ No LLM key! Set GEMINI_API_KEY (preferred) or ANTHROPIC_API_KEY.')
  }
})()

// ━━━━━ Connection pre-warming ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
    } catch (_) {
      /* ignore keepalive failures */
    }
  }
}, API_KEEPALIVE_MS)

// ━━━━━ Practice cache ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
    console.warn('✗ ⚠️  Practice cache refresh failed:', err)
    return practiceCache
  }
}

getCachedPractices().catch(console.error)

// ━━━━━ Session tracking ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

// ━━━━━ Express app ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
    console.warn('✗ ⚠️  Greeting lookup failed:', err)
  }

  const greetingEscaped = welcomeGreeting
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const wsHost = process.env.VOICE_SERVER_HOST || req.headers.host || 'localhost:3001'
  const wsProtocol = process.env.NODE_ENV === 'production' ? 'wss' : 'ws'
  const wsUrl = `${wsProtocol}://${wsHost}/ws?callerPhone=${encodeURIComponent(callerNumber)}&calledNumber=${encodeURIComponent(calledNumber)}`

  const voiceId = ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'
  const voiceWithSettings = `${voiceId}-0.9_0.7_0.8`

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay url="${wsUrl.replace(/&/g, '&amp;')}" voice="${voiceWithSettings}" ttsProvider="ElevenLabs" transcriptionProvider="Google" speechModel="telephony" language="en-US" interruptible="true" dtmfDetection="true" welcomeGreeting="${greetingEscaped}" />
  </Connect>
</Response>`

  res.type('text/xml').send(twiml)
})

// ━━━━━ WebSocket ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', async (ws: WebSocket, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`)
  const callerPhone = url.searchParams.get('callerPhone') || null
  const calledNumber = url.searchParams.get('calledNumber') || null

  console.log(`📡 WebSocket connected | caller: ${callerPhone} | called: ${calledNumber} | remoteAddress: ${req.socket.remoteAddress}`)

  let sessionId = `temp-${Date.now()}`
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping()
  }, 20000)

  ws.on('message', async (data) => {
    try {
      const raw = data.toString()
      const message = JSON.parse(raw)
      const preview = raw.length > 200 ? raw.substring(0, 200) + '...' : raw
      console.log(`🔤 [${message.type}]: ${preview}`)

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
          console.log(`☎️  DTMF: ${message.digit} (${sessionId})`)
          break
        default:
          console.log(`⚠️  Unknown: ${message.type}`)
      }
    } catch (error) {
      console.error('WS message error:', error)
    }
  })

  ws.on('close', () => {
    clearInterval(pingInterval)
    handleDisconnect(sessionId)
  })

  ws.on('error', (err) => {
    clearInterval(pingInterval)
    console.error(`WS error (${sessionId}):`, err)
  })
})

// ━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function handleSetup(
  ws: WebSocket,
  message: any,
  callerPhone: string | null,
  calledNumber: string | null
) {
  const callSid = message.callSid
  console.log(`⚙️  Setup: ${callSid}`)

  let practiceId: string | null = null
  let practiceConfig: PracticeConfig | null = null

  if (calledNumber) {
    console.log(`📞 Phone matching: calledNumber="${calledNumber}" | callerPhone="${callerPhone}"`)

    const digits = calledNumber.replace(/\D/g, '').slice(-10)
    console.log(`📍 Extracted digits for matching: "${digits}" (last 10 digits)`)

    const practices = await getCachedPractices()
    console.log(`📋 Found ${practices.length} practices in cache`)

    // Log all practices and their phone numbers
    practices.forEach((p: any, idx: number) => {
      const practiceDigits = p.phone_number?.replace(/\D/g, '').slice(-10) || 'N/A'
      const isMatch = practiceDigits === digits
      console.log(`  [${idx}] "${p.name}" | phone="${p.phone_number}" | digits="${practiceDigits}"${isMatch ? ' ✓ MATCH' : ''}`)
    })

    const match = practices.find(
      (p: any) => p.phone_number?.replace(/\D/g, '').slice(-10) === digits
    )

    if (match) {
      console.log(`✓ Phone match found: "${match.name}" (id: ${match.id})`)
      practiceId = match.id
      const profile = match.onboarding_profile || {}
      practiceConfig = {
        therapist_name: match.provider_name || match.name || 'the therapist',
        practice_name: match.name || 'the practice',
        ai_name: match.ai_name || 'Harbor',
        therapist_title: match.therapist_title || profile.therapist_title || undefined,
        therapist_pronouns:
          match.therapist_pronouns || profile.therapist_pronouns || undefined,
        practice_vibe: match.practice_vibe || profile.practice_vibe || undefined,
        receptionist_personality:
          match.receptionist_personality || profile.receptionist_personality || undefined,
        specialties: match.specialties || profile.specialties || [],
        populations_served: match.populations_served || profile.populations_served || undefined,
        modalities: match.modalities || profile.modalities || undefined,
        languages: match.languages || profile.languages || undefined,
        hours: match.hours || match.office_hours || undefined,
        session_length_minutes:
          match.session_length_minutes || profile.session_length_minutes || undefined,
        booking_lead_days: match.booking_lead_days || profile.booking_lead_days || undefined,
        new_patient_callback_time:
          match.new_patient_callback_time || profile.new_patient_callback_time || undefined,
        evening_weekend_available:
          match.evening_weekend_available ?? profile.evening_weekend_available ?? false,
        intake_process_notes:
          match.intake_process_notes || profile.intake_process_notes || undefined,
        location: match.location || match.address || undefined,
        parking_notes: match.parking_notes || profile.parking_notes || undefined,
        telehealth: match.telehealth ?? match.telehealth_available ?? true,
        website: match.website || profile.website || undefined,
        insurance_accepted: match.insurance_accepted || [],
        sliding_scale: match.sliding_scale ?? profile.sliding_scale ?? false,
        cancellation_policy: match.cancellation_policy || profile.cancellation_policy || undefined,
        new_patients_accepted: match.accepting_new_patients ?? true,
        waitlist_enabled: match.waitlist_enabled ?? false,
        after_hours_emergency:
          match.after_hours_emergency || profile.after_hours_emergency || undefined,
        emotional_support_enabled: match.emotional_support_enabled ?? true,
        system_prompt_notes: match.system_prompt_notes || profile.system_prompt_notes || undefined,
        onboarding_profile: profile,
      }
      console.log(`✓ Practice: ${practiceConfig.practice_name}`)
    } else {
      console.log(`✗ No phone match found for digits: "${digits}"`)
    }
  } else {
    console.log(`⚠️  No calledNumber provided for phone matching`)
  }

  if (!practiceConfig) {
    practiceConfig = {
      therapist_name: 'the therapist',
      practice_name: 'the practice',
    }
  }

  // Fetch recent cancellation openings to inform the AI about available slots
  if (practiceId) {
    try {
      const now = new Date()
      const twoDaysOut = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)
      const { data: cancelledAppts } = await supabase
        .from('appointments')
        .select('appointment_date, appointment_time, duration_minutes')
        .eq('practice_id', practiceId)
        .eq('status', 'cancelled')
        .gte('appointment_date', now.toISOString().split('T')[0])
        .lte('appointment_date', twoDaysOut.toISOString().split('T')[0])
        .order('appointment_date')
        .order('appointment_time')
        .limit(5)

      if (cancelledAppts?.length) {
        practiceConfig.available_openings = cancelledAppts.map((a) => ({
          date: new Date(a.appointment_date).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          }),
          time: a.appointment_time || 'TBD',
          type: practiceConfig?.telehealth ? 'telehealth or in-person' : 'in-person',
        }))
        console.log(`📅 ${cancelledAppts.length} recent openings loaded for AI`)
      }
    } catch (err) {
      console.error('Failed to fetch openings (non-blocking):', err)
    }
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

  console.log(
    `🔌 Provider: ${PROVIDER} | Model: ${VOICE_MODEL} | prompt: ${systemPrompt.length} chars`
  )
}

async function handlePrompt(ws: WebSocket, message: any, sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) {
    console.warn(`No session: ${sessionId}`)
    sendText(ws, "I'm sorry, I'm having a technical issue. Could you please call back?")
    return
  }

  const utterance = message.voicePrompt || ''
  console.log(
    `🗣️  Caller: "${utterance}" (${sessionId}) [${session.messages.length} msgs]`
  )

  if (ws.readyState !== WebSocket.OPEN) return

  session.transcript.push(`Caller: ${utterance}`)

  // ━━━━━ Crisis check ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const scan = scanUtterance(utterance)

  if (scan.immediateCrisis) {
    console.log(`🚨 CRISIS: ${scan.matchedPhrases.join(', ')}`)
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
    console.log(`⚠️  Tripwire: ${scan.matchedPhrases.join(', ')}`)
    const [llmResp, assessment] = await Promise.all([
      getLLMResponse(session, utterance),
      analyzeWithSonnet(session.transcript.join('\n'), scan.matchedPhrases, {
        therapistName: session.practiceConfig?.therapist_name || 'the therapist',
        practiceName: session.practiceConfig?.practice_name || 'the practice',
      }),
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

  // ━━━━━ Normal conversation (streamed for lowest latency) ━━━━━━━━━━━━━━
  try {
    const response = await streamLLMResponse(ws, session, utterance)
    session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${response}`)
    console.log(
      `💬 ${session.practiceConfig?.ai_name || 'Harbor'}: "${response.substring(0, 100)}..."`
    )
  } catch (err) {
    console.error('LLM error:', err)
    sendText(ws, "I'm sorry, I'm having a brief technical issue. Could you repeat that?")
  }
}

function handleInterrupt(sessionId: string, message: any) {
  const session = sessions.get(sessionId)
  if (!session) return

  console.log(`⏸️  Interrupted (${sessionId})`)

  if (message.utteranceUntilInterrupt) {
    const last = session.transcript.length - 1
    if (last >= 0 && session.transcript[last].startsWith(session.practiceConfig?.ai_name || 'Harbor')) {
      session.transcript[last] += ` [interrupted]`
    }
  }
}

// ━━━━━ ✨ Structured data extracted from a call transcript ✨ ━━━━━
interface ExtractedCallData {
  caller_name: string | null
  first_name: string | null
  last_name: string | null
  insurance: string | null
  session_type: 'telehealth' | 'in-person' | null
  preferred_times: string | null
  reason_for_calling: string | null
  call_type: 'new_patient' | 'existing_patient' | 'scheduling' | 'cancellation' | 'question' | 'crisis' | 'other'
  summary: string
}

async function extractCallData(
  transcript: string[],
  practiceConfig: PracticeConfig | null
): Promise<ExtractedCallData | null> {
  const fullTranscript = transcript.join('\n')
  if (!fullTranscript || fullTranscript.length < 20) return null

  const aiName = practiceConfig?.ai_name || 'Harbor'
  const practiceName = practiceConfig?.practice_name || 'the practice'

  const prompt = `You are analyzing a phone call handled by ${aiName}, the AI receptionist for ${practiceName} (a therapy practice). Extract structured data from this call transcript. Return ONLY valid JSON (no markdown, no backticks, no explanation). Required JSON format:
{
  "caller_name": "Full name if given, or null",
  "first_name": "First name if given, or null",
  "last_name": "Last name if given, or null",
  "insurance": "Insurance provider mentioned, or null",
  "session_type": "telehealth" or "in-person" or null,
  "preferred_times": "Any scheduling preferences mentioned, or null",
  "reason_for_calling": "Brief reason (e.g. 'new patient seeking anxiety therapy'), or null",
  "call_type": "new_patient" or "existing_patient" or "scheduling" or "cancellation" or "question" or "crisis" or "other",
  "summary": "2-3 sentence summary of the call including why they called, key details, and outcome"
}

Rules:
- Only extract information the caller explicitly stated. Do NOT infer or guess.
- If the caller only gave a first name, set last_name to null.
- For call_type: use "new_patient" if they're calling for the first time or asking about becoming a patient. Use "existing_patient" if they reference previous appointments or their therapist.
- If the call was very short (caller hung up quickly), set call_type to "other" and note it in the summary.

Transcript:
${fullTranscript}`

  let responseText = ''
  try {

    if (genai) {
      const result = await genai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      })
      responseText = getGeminiText(result).trim()
    } else {
      const result = await anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      })
      const textBlock = result.content.find((b) => b.type === 'text')
      responseText = textBlock?.text?.trim() || ''
    }

    // Strip markdown code fences if present
    responseText = responseText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
    const parsed = JSON.parse(responseText) as ExtractedCallData
    console.log(`✓ Extracted call data: type=${parsed.call_type}, name=${parsed.caller_name}, summary=${parsed.summary?.substring(0, 80)}`)
    return parsed
  } catch (err) {
    console.error('Call data extraction failed:', err)
    console.error('  Response text was:', responseText?.substring(0, 200))
    return null
  }
}

async function handleDisconnect(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) return

  const duration = Math.round((Date.now() - session.startTime.getTime()) / 1000)
  console.log(`🔴 Call ended: ${sessionId} (${duration}s)`)

  try {
    if (session.practiceId) {
      // Practice ID exists, proceed with normal call logging
      const transcriptText = session.transcript.join('\n')
      const { data: inserted, error: insertError } = await supabase
        .from('call_logs')
        .insert({
          practice_id: session.practiceId,
          patient_phone: session.callerPhone || 'unknown',
          transcript: transcriptText,
          duration_seconds: duration,
          summary: '',
          crisis_detected: session.crisisState?.level === 'crisis',
        })
        .select('id')
        .single()

      if (insertError) {
        console.error('Failed to insert call log:', insertError)
      } else {
        console.log(`✓ Call logged (${inserted.id})`)

        // Extract structured data + summary asynchronously (don't block disconnect cleanup)
        if (session.transcript.length >= 2) {
          extractAndLinkPatient(inserted.id, session).catch((err) =>
            console.error('Post-call extraction failed:', err)
          )
        }
      }
    } else {
      // Practice ID is NULL - log detailed debugging info
      console.error(`🔍 UNMATCHED CALL - Cannot insert to call_logs (practice_id is null)`)
      console.error(`   calledNumber: ${session.practiceConfig?.practice_name || 'N/A (no config)'}`)
      console.error(`   callerPhone: ${session.callerPhone || 'unknown'}`)
      console.error(`   Transcript snippet: ${session.transcript.slice(-3).join(' | ').substring(0, 300)}`)
      console.error(`   Crisis detected: ${session.crisisState?.level === 'crisis' ? 'YES' : 'NO'}`)
      console.error(`   Message count: ${session.messages.length}`)
      console.error(
        `   Duration: ${duration}s | Timestamp: ${new Date().toISOString()}`
      )
    }
  } catch (error) {
    console.error('Failed to log call:', error)
  }

  sessions.delete(sessionId)
}

// ━━━━━ Post-call: extract structured data, upsert patient, link to call log ━━━━━
async function extractAndLinkPatient(callLogId: string, session: CallSession) {
  const extracted = await extractCallData(session.transcript, session.practiceConfig)
  if (!extracted) return

  // Always update the call log with summary + extracted fields
  const callUpdate: Record<string, any> = {
    summary: extracted.summary,
    call_type: extracted.call_type,
    caller_name: extracted.caller_name,
    insurance_mentioned: extracted.insurance,
    session_type: extracted.session_type,
    preferred_times: extracted.preferred_times,
    reason_for_calling: extracted.reason_for_calling,
  }

  // Try to find or create a patient record if we have a phone number
  const callerPhone = session.callerPhone
  if (callerPhone && callerPhone !== 'unknown' && session.practiceId) {
    try {
      // Check if patient already exists for this practice + phone
      const { data: existingPatient } = await supabase
        .from('patients')
        .select('id, first_name, last_name, insurance, reason_for_seeking')
        .eq('practice_id', session.practiceId)
        .eq('phone', callerPhone)
        .single()

      if (existingPatient) {
        // Update existing patient with any new info from this call
        const patientUpdate: Record<string, any> = {}
        if (extracted.first_name && !existingPatient.first_name) {
          patientUpdate.first_name = extracted.first_name
        }
        if (extracted.last_name && !existingPatient.last_name) {
          patientUpdate.last_name = extracted.last_name
        }
        if (extracted.insurance && !existingPatient.insurance) {
          patientUpdate.insurance = extracted.insurance
        }
        if (extracted.reason_for_calling && !existingPatient.reason_for_seeking) {
          patientUpdate.reason_for_seeking = extracted.reason_for_calling
        }
        if (extracted.session_type) {
          patientUpdate.preferred_session_type = extracted.session_type
        }

        if (Object.keys(patientUpdate).length > 0) {
          await supabase.from('patients').update(patientUpdate).eq('id', existingPatient.id)
          console.log(`✓ Updated patient ${existingPatient.id} with new call data`)
        }
        callUpdate.patient_id = existingPatient.id
      } else if (extracted.first_name) {
        // Create new patient record (only if we at least have a first name)
        const { data: newPatient, error: patientError } = await supabase
          .from('patients')
          .insert({
            practice_id: session.practiceId,
            first_name: extracted.first_name,
            last_name: extracted.last_name || '',
            phone: callerPhone,
            insurance: extracted.insurance,
            reason_for_seeking: extracted.reason_for_calling,
            preferred_session_type: extracted.session_type,
          })
          .select('id')
          .single()

        if (patientError) {
          console.error('Failed to create patient:', patientError)
        } else if (newPatient) {
          callUpdate.patient_id = newPatient.id
          console.log(
            `✓ New patient created: ${extracted.first_name} ${extracted.last_name || ''} (${newPatient.id})`
          )
        }
      }
    } catch (err) {
      console.error('Patient upsert failed:', err)
    }
  }

  // Update call log with all extracted data
  const { error: updateError } = await supabase
    .from('call_logs')
    .update(callUpdate)
    .eq('id', callLogId)

  if (updateError) {
    console.error('Failed to update call log with extracted data:', updateError)
  } else {
    console.log(
      `✓ Call ${callLogId}: extracted data saved (type: ${extracted.call_type}, name: ${extracted.caller_name || 'unknown'})`
    )
  }
}

// ━━━━━ Gemini / Anthropic LLM helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Convert our message format to Gemini's content format
function toGeminiContents(messages: Array<{ role: string; content: string }>) {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: m.content }],
  }))
}

// ━━━━━ LLM streaming (primary path for all normal conversation) ━━━━━━━━━━
// Gemini Flash: ~200ms TTFB – 2x faster than Haiku
// Streams tokens to ConversationRelay so TTS starts immediately
async function streamLLMResponse(
  ws: WebSocket,
  session: CallSession,
  utterance: string
): Promise<string> {
  session.messages.push({ role: 'user', content: utterance })
  const trimmed = session.messages.slice(-MAX_HISTORY)
  const t0 = Date.now()
  let firstTokenTime = 0
  let fullText = ''

  try {
    if (useGemini && genai) {
      // ━━━━━ Gemini Flash streaming path ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
      // ━━━━━ Anthropic Haiku fallback ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

    console.log(
      `✓ ${PROVIDER} stream: TTFB=${ttfb}ms total=${totalMs}ms | len=${fullText.length} | history=${trimmed.length}`
    )

    session.messages.push({ role: 'assistant', content: fullText })
    return fullText
  } catch (error: any) {
    const latency = Date.now() - t0
    console.error(
      `✗ ${PROVIDER} stream error (${latency}ms):`,
      error?.message?.substring(0, 200) || error
    )

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
      text = getGeminiText(response) || "I'm sorry, I didn't catch that. Could you say that again?"
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
      text =
        response.content[0].type === 'text'
          ? response.content[0].text
          : "I'm sorry, I didn't catch that. Could you say that again?"
    }

    const latency = Date.now() - t0
    console.log(
      `✓ ${PROVIDER} in ${latency}ms | len=${text.length} | history=${trimmed.length}`
    )

    session.messages.push({ role: 'assistant', content: text })
    return text
  } catch (error: any) {
    const latency = Date.now() - t0
    console.error(
      `✗ ${PROVIDER} error (${latency}ms):`,
      error?.message?.substring(0, 200) || error
    )
    session.messages.pop()
    return "I'm sorry, I'm having a brief technical issue. Could you repeat that?"
  }
}

// ━━━━━ Send to ConversationRelay ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function sendText(ws: WebSocket, text: string) {
  if (ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'text', token: text, last: true }))
}

// ━━━━━ Crisis alerting ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
        '',
        'A caller may be in distress. Please review.',
        '',
        'If immediate danger: call 911',
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
      transcript_snippet: session.transcript
        .slice(-6)
        .join('\n')
        .substring(0, 500),
      detected_phrases: phrases,
      alert_sent: true,
      created_at: new Date().toISOString(),
    })
  } catch (error) {
    console.warn('Crisis log failed:', error)
  }
}

// ━━━━━ Start ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
server.listen(PORT, () => {
  console.log(`
╭──────────────────────────────────────────────────────────────────╮
│                  Harbor Voice Server                             │
├──────────────────────────────────────────────────────────────────┤
│  Provider:   ${(PROVIDER + ' ').slice(0, 20)}                      │
│  Model:      ${(VOICE_MODEL + ' ').slice(0, 20)}                 │
│  WS:         ws://localhost:${PORT}/ws                           │
│  TwiML:      http://localhost:${PORT}/twiml                      │
│                                                                  │
│  Gemini:     ${GEMINI_API_KEY ? '✓' : '✗'}                                              │
│  Anthropic:  ${ANTHROPIC_API_KEY ? '✓' : '✗'} (crisis detection)              │
│  Supabase:   ${SUPABASE_URL ? '✓' : '✗'}                                              │
│  Twilio:     ${TWILIO_ACCOUNT_SID ? '✓' : '✗'}                                              │
│  Voice:      ElevenLabs Flash 2.5                                │
├──────────────────────────────────────────────────────────────────┤
╰──────────────────────────────────────────────────────────────────╯
  `)
})

export { app, server }
// Harbor Voice Server
