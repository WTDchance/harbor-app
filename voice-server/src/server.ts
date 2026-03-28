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

// Ã¢ÂÂÃ¢ÂÂ Environment Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
const PORT = parseInt(process.env.PORT || '3001', 10)
const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || ''
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || ''

// Ã¢ÂÂÃ¢ÂÂ Clients Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY }) // kept for crisis detection (Sonnet)
const genai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null

// Ã¢ÂÂÃ¢ÂÂ Model selection Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// Gemini 2.0 Flash: ~200ms TTFB, excellent for voice (fast + cheap)
// Falls back to Anthropic Haiku if no Gemini key
const useGemini = !!genai
const VOICE_MODEL = useGemini ? 'gemini-2.0-flash' : 'claude-haiku-4-5-20251001'
const PROVIDER = useGemini ? 'Gemini' : 'Anthropic'

// Startup check
;(async () => {
  if (useGemini) {
    console.log(`Ã°ÂÂÂ Gemini key present (${GEMINI_API_KEY.substring(0, 10)}...)`)
    try {
      const test = await genai!.models.generateContent({
        model: VOICE_MODEL,
        contents: 'Say "ok"',
        config: { maxOutputTokens: 10 },
      })
      console.log(`Ã¢ÂÂ Gemini Flash verified: "${test.text}"`)
    } catch (err: any) {
      console.error(`Ã¢ÂÂ Gemini API FAILED: ${err?.message?.substring(0, 200)}`)
    }
  } else if (ANTHROPIC_API_KEY) {
    console.log(`Ã¢ÂÂ Ã¯Â¸Â  No GEMINI_API_KEY Ã¢ÂÂ falling back to Haiku (slower)`)
    try {
      const test = await anthropic.messages.create({
        model: VOICE_MODEL,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say "ok"' }],
      })
      const txt = test.content[0].type === 'text' ? test.content[0].text : '?'
      console.log(`Ã¢ÂÂ Haiku verified: "${txt}"`)
    } catch (err: any) {
      console.error(`Ã¢ÂÂ Haiku FAILED: ${err?.status} ${err?.message?.substring(0, 200)}`)
    }
  } else {
    console.error('Ã¢ÂÂ No LLM key! Set GEMINI_API_KEY (preferred) or ANTHROPIC_API_KEY.')
  }
})()

// Ã¢ÂÂÃ¢ÂÂ Connection pre-warming Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
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

// Ã¢ÂÂÃ¢ÂÂ Practice cache Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
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
      console.log(`Ã¢ÂÂ Practice cache refreshed: ${data.length} practices`)
    }
    return practiceCache
  } catch (err) {
    console.warn('Ã¢ÂÂ Ã¯Â¸Â  Practice cache refresh failed:', err)
    return practiceCache
  }
}

getCachedPractices().catch(console.error)

// Ã¢ÂÂÃ¢ÂÂ Session tracking Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
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

// Ã¢ÂÂÃ¢ÂÂ Express app Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
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

  console.log(`Ã°ÂÂÂ Incoming call: ${callerNumber} Ã¢ÂÂ ${calledNumber} (${callSid})`)

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
        console.log(`Ã¢ÂÂ Personalized greeting for: ${practiceName}`)
      }
    }
  } catch (err) {
    console.warn('Ã¢ÂÂ Ã¯Â¸Â  Greeting lookup failed:', err)
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

// Ã¢ÂÂÃ¢ÂÂ WebSocket Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', async (ws: WebSocket, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`)
  const callerPhone = url.searchParams.get('callerPhone') || null
  const calledNumber = url.searchParams.get('calledNumber') || null

  console.log(`Ã°ÂÂÂ WebSocket connected | caller: ${callerPhone}`)

  let sessionId = `temp-${Date.now()}`

  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping()
  }, 20000)

  ws.on('message', async (data) => {
    try {
      const raw = data.toString()
      const message = JSON.parse(raw)
      const preview = raw.length > 200 ? raw.substring(0, 200) + '...' : raw
      console.log(`Ã°ÂÂÂ¨ [${message.type}]: ${preview}`)

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
          console.log(`Ã°ÂÂÂ¢ DTMF: ${message.digit} (${sessionId})`)
          break
        default:
          console.log(`Ã¢ÂÂ Unknown: ${message.type}`)
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

// Ã¢ÂÂÃ¢ÂÂ Handlers Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

async function handleSetup(
  ws: WebSocket,
  message: any,
  callerPhone: string | null,
  calledNumber: string | null
) {
  const callSid = message.callSid
  console.log(`Ã°ÂÂÂ Setup: ${callSid}`)

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
      console.log(`Ã¢ÂÂ Practice: ${practiceConfig.practice_name}`)
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

  console.log(`Ã°ÂÂ§Â  Provider: ${PROVIDER} | Model: ${VOICE_MODEL} | prompt: ${systemPrompt.length} chars`)
}

async function handlePrompt(ws: WebSocket, message: any, sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) {
    console.warn(`No session: ${sessionId}`)
    sendText(ws, "I'm sorry, I'm having a technical issue. Could you please call back?")
    return
  }

  const utterance = message.voicePrompt || ''
  console.log(`Ã°ÂÂÂ£Ã¯Â¸Â  Caller: "${utterance}" (${sessionId}) [${session.messages.length} msgs]`)

  if (ws.readyState !== WebSocket.OPEN) return

  session.transcript.push(`Caller: ${utterance}`)

  // Ã¢ÂÂÃ¢ÂÂ Crisis check Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
  const scan = scanUtterance(utterance)

  if (scan.immediateCrisis) {
    console.log(`Ã°ÂÂÂ¨ CRISIS: ${scan.matchedPhrases.join(', ')}`)
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
    console.log(`Ã¢ÂÂ Ã¯Â¸Â  Tripwire: ${scan.matchedPhrases.join(', ')}`)

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

  // Ã¢ÂÂÃ¢ÂÂ Normal conversation (streamed for lowest latency) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
  try {
    const response = await streamLLMResponse(ws, session, utterance)
    session.transcript.push(`${session.practiceConfig?.ai_name || 'Harbor'}: ${response}`)
    console.log(`Ã°ÂÂÂ¬ ${session.practiceConfig?.ai_name || 'Harbor'}: "${response.substring(0, 100)}..."`)
  } catch (err) {
    console.error('LLM error:', err)
    sendText(ws, "I'm sorry, I'm having a brief technical issue. Could you repeat that?")
  }
}

function handleInterrupt(sessionId: string, message: any) {
  const session = sessions.get(sessionId)
  if (!session) return
  console.log(`Ã°ÂÂ¤Â Interrupted (${sessionId})`)
  if (message.utteranceUntilInterrupt) {
    const last = session.transcript.length - 1
    if (last >= 0 && session.transcript[last].startsWith(session.practiceConfig?.ai_name || 'Harbor')) {
      session.transcript[last] += ` [interrupted]`
    }
  }
}

async function generateCallSummary(transcript: string[], practiceConfig: PracticeConfig | null): Promise<string> {
  const fullTranscript = transcript.join('\n')
  if (!fullTranscript || fullTranscript.length < 20) return ''

  const aiName = practiceConfig?.ai_name || 'Harbor'
  const practiceName = practiceConfig?.practice_name || 'the practice'
  const prompt = `You are summarizing a phone call handled by ${aiName}, the AI receptionist for ${practiceName} (a therapy practice).

Write a brief 2-3 sentence summary of the call. Include:
- Why the caller called (scheduling, question, new patient inquiry, etc.)
- Key details mentioned (name if given, insurance, preferred times, etc.)
- The outcome (appointment scheduled, message taken, info provided, etc.)

If the call was very short or the caller hung up quickly, just note that.

Transcript:
${fullTranscript}`

  try {
    if (genai) {
      const result = await genai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
      })
      return result.text?.trim() || ''
    } else {
      const result = await anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      })
      const textBlock = result.content.find(b => b.type === 'text')
      return textBlock?.text?.trim() || ''
    }
  } catch (err) {
    console.error('Summary generation failed:', err)
    return ''
  }
}

async function handleDisconnect(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) return

  const duration = Math.round((Date.now() - session.startTime.getTime()) / 1000)
  console.log(`\u{1F534} Call ended: ${sessionId} (${duration}s)`)

  try {
    if (session.practiceId) {
      const transcriptText = session.transcript.join('\n')

      const { data: inserted, error: insertError } = await supabase.from('call_logs').insert({
        practice_id: session.practiceId,
        patient_phone: session.callerPhone || 'unknown',
        transcript: transcriptText,
        duration_seconds: duration,
        summary: '',
        crisis_detected: session.crisisState?.level === 'crisis',
      }).select('id').single()

      if (insertError) {
        console.error('Failed to insert call log:', insertError)
      } else {
        console.log(`\u2713 Call logged (${inserted.id})`)

        // Generate and update summary asynchronously (don't block disconnect cleanup)
        if (session.transcript.length >= 2) {
          generateCallSummary(session.transcript, session.practiceConfig).then(async (summary) => {
            if (summary) {
              await supabase.from('call_logs')
                .update({ summary })
                .eq('id', inserted.id)
              console.log(`\u2713 Summary generated for call ${inserted.id}`)
            }
          }).catch(err => console.error('Summary update failed:', err))
        }
      }
    }
  } catch (error) {
    console.error('Failed to log call:', error)
  }

  sessions.delete(sessionId)
}

// Ã¢ÂÂÃ¢ÂÂ Gemini / Anthropic LLM helpers Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

// Convert our message format to Gemini's content format
function toGeminiContents(messages: Array<{ role: string; content: string }>) {
  return messages.map(m => ({
    role: m.role === 'assistant' ? 'model' as const : 'user' as const,
    parts: [{ text: m.content }],
  }))
}

// Ã¢ÂÂÃ¢ÂÂ LLM streaming (primary path for all normal conversation) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// Gemini Flash: ~200ms TTFB Ã¢ÂÂ 2x faster than Haiku
// Streams tokens to ConversationRelay so TTS starts immediately

async function streamLLMResponse(ws: WebSocket, session: CallSession, utterance: string): Promise<string> {
  session.messages.push({ role: 'user', content: utterance })
  const trimmed = session.messages.slice(-MAX_HISTORY)
  const t0 = Date.now()
  let firstTokenTime = 0
  let fullText = ''

  try {
    if (useGemini && genai) {
      // Ã¢ÂÂÃ¢ÂÂ Gemini Flash streaming path Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
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
      // Ã¢ÂÂÃ¢ÂÂ Anthropic Haiku fallback Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
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

    console.log(`Ã¢ÂÂ¡ ${PROVIDER} stream: TTFB=${ttfb}ms total=${totalMs}ms | len=${fullText.length} | history=${trimmed.length}`)

    session.messages.push({ role: 'assistant', content: fullText })
    return fullText

  } catch (error: any) {
    const latency = Date.now() - t0
    console.error(`Ã¢ÂÂ ${PROVIDER} stream error (${latency}ms):`, error?.message?.substring(0, 200) || error)

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
    console.log(`Ã¢ÂÂ¡ ${PROVIDER} in ${latency}ms | len=${text.length} | history=${trimmed.length}`)
    session.messages.push({ role: 'assistant', content: text })
    return text

  } catch (error: any) {
    const latency = Date.now() - t0
    console.error(`Ã¢ÂÂ ${PROVIDER} error (${latency}ms):`, error?.message?.substring(0, 200) || error)
    session.messages.pop()
    return "I'm sorry, I'm having a brief technical issue. Could you repeat that?"
  }
}

// Ã¢ÂÂÃ¢ÂÂ Send to ConversationRelay Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
function sendText(ws: WebSocket, text: string) {
  if (ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'text', token: text, last: true }))
}

// Ã¢ÂÂÃ¢ÂÂ Crisis alerting Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
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
        'Ã°ÂÂÂ¨ HARBOR CRISIS ALERT',
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

    console.log(`Ã°ÂÂÂ¨ Crisis alert sent to ${alertPhone}`)
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

// Ã¢ÂÂÃ¢ÂÂ Start Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
server.listen(PORT, () => {
  console.log(`
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
Ã¢ÂÂ            Harbor Voice Server                   Ã¢ÂÂ
Ã¢ÂÂ                                                  Ã¢ÂÂ
Ã¢ÂÂ  Provider:  ${(PROVIDER + '                      ').slice(0, 20)}Ã¢ÂÂ
Ã¢ÂÂ  Model:     ${(VOICE_MODEL + '                      ').slice(0, 20)}Ã¢ÂÂ
Ã¢ÂÂ  WS:        ws://localhost:${PORT}/ws              Ã¢ÂÂ
Ã¢ÂÂ  TwiML:     http://localhost:${PORT}/twiml         Ã¢ÂÂ
Ã¢ÂÂ                                                    Ã¢ÂÂ
Ã¢ÂÂ  Gemini:    ${GEMINI_API_KEY ? 'Ã¢ÂÂ' : 'Ã¢ÂÂ'}                                 Ã¢ÂÂ
Ã¢ÂÂ  Anthropic: ${ANTHROPIC_API_KEY ? 'Ã¢ÂÂ' : 'Ã¢ÂÂ'} (crisis detection)          Ã¢ÂÂ
Ã¢ÂÂ  Supabase:  ${SUPABASE_URL ? 'Ã¢ÂÂ' : 'Ã¢ÂÂ'}                                 Ã¢ÂÂ
Ã¢ÂÂ  Twilio:    ${TWILIO_ACCOUNT_SID ? 'Ã¢ÂÂ' : 'Ã¢ÂÂ'}                                 Ã¢ÂÂ
Ã¢ÂÂ  Voice:     ElevenLabs Flash 2.5                 Ã¢ÂÂ
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
  `)
})

export { app, server }
