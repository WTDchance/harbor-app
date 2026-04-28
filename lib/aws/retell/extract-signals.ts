// lib/aws/retell/extract-signals.ts
//
// Wave 45 — Retell call-transcript signal extraction.
//
// Receptionist calls are Harbor's unique predictive moat: every other
// mental-health EHR has appointments + payments, but only Harbor has a
// fully-transcribed AI receptionist. Those transcripts contain HIGH-
// SIGNAL data for predicting no-shows, dropouts, reschedule willingness,
// and crisis risk that competitors literally cannot replicate.
//
// This module turns one transcript into one structured signal payload.
// It is invoked from app/api/retell/webhook/route.ts on the
// `call_analyzed` event (and falls back to `call_ended` if Retell did
// not run analysis). It feeds the broader Wave 45 prediction layer
// (ehr_patient_signals → ehr_patient_predictions → today-screen UI),
// owned by the parallel branch.
//
// Two layers:
//   (a) Deterministic regex/string scan — cheap, runs always.
//       Catches explicit cancel/reschedule/crisis markers.
//   (b) Bedrock-augmented extraction — runs on top of (a) when the
//       transcript is non-trivial. Returns a structured JSON object the
//       webhook can persist.
//
// Privacy:
//   - All processing is in AWS via Bedrock (HIPAA BAA already covers).
//   - Transcripts are PHI; we never log them in plain text. The
//     structured logger (lib/observability/structured-log.ts) redacts
//     known sensitive keys, but here we additionally never put
//     transcript content into log fields — only counts and call_id.
//   - Audit logging of the extraction itself is the webhook's job.

import { createMessage } from '@/lib/aws/llm'
import { IMMEDIATE_CRISIS_PHRASES } from '@/lib/crisis-phrases'

// --- Types ------------------------------------------------------------------

export interface HesitationMarker {
  /** lowercase token or phrase that matched, e.g. "um", "actually" */
  term: string
  /** character index in the (un-truncated) transcript */
  index: number
}

export interface ExtractedSignals {
  no_show_intent: boolean | null
  reschedule_intent: boolean | null
  crisis_risk: boolean | null
  sentiment_score: number | null // -1..+1, where 0 is neutral
  hesitation_count: number | null
  hesitation_markers: HesitationMarker[]
  /** 3-5 quoted phrases from the transcript that informed the scores. */
  key_phrases: string[]
  confidence: number | null // 0..1
  /** Which layer produced these signals. */
  source: 'empty' | 'regex_only' | 'regex+ai' | 'ai_only'
  /** Whether the AI layer was reached (false = fell back to regex). */
  ai_used: boolean
  /** When ai_used = false, why. */
  fallback_reason?: string
}

export interface ExtractSignalsArgs {
  callId: string
  transcript: string | null
  /** Retell's call_analysis payload, if any. */
  callAnalysis?: {
    call_summary?: string | null
    user_sentiment?: string | null
    custom_analysis_data?: Record<string, unknown> | null
  } | null
  /** First name only — used to keep prompt natural. Defaults to "the patient". */
  patientFirstName?: string | null
}

// --- Constants --------------------------------------------------------------

// Token-based truncation isn't worth a tokenizer dep here. Approximate at
// 4 chars/token — 8K tokens ≈ 32K chars. If the transcript exceeds, we
// keep the first 16K chars and last 16K chars; receptionist calls are
// usually under 2K tokens so this almost never trips.
const MAX_TRANSCRIPT_CHARS = 32_000

// Cancel-intent regexes. Word boundaries keep "cancellation policy" out
// of the no-show bucket. Matches are case-insensitive.
const CANCEL_REGEX = [
  /\bcancel\b(?!\s*(?:policy|fee))/i,
  /\bcanceling\b/i,
  /\bcancelling\b/i,
  /\bwon[' ]?t make it\b/i,
  /\bcan[' ]?t make it\b/i,
  /\bcan[' ]?t come\b/i,
  /\bnot going to (?:make|come)\b/i,
  /\bskip(?:ping)? (?:my|the|this)\b/i,
  /\bnot (?:going to|gonna) be (?:able to|there)\b/i,
]

const RESCHEDULE_REGEX = [
  /\breschedule\b/i,
  /\bmove (?:my|the) (?:appointment|appt|session)\b/i,
  /\bdifferent (?:time|day|date)\b/i,
  /\b(?:another|new) (?:time|day|date)\b/i,
  /\bnext week instead\b/i,
  /\bcan we (?:push|move|shift)\b/i,
  /\bchange (?:my|the) (?:appointment|appt|session)\b/i,
]

// Hesitation tokens. Counts approximate, not exact phonetic markers —
// pulled from a transcript, not raw audio, so "um" and "uh" only land
// when Retell preserved them. Mid-sentence corrections are detected via
// "actually" / "wait" / "I mean" patterns.
const HESITATION_REGEX = [
  /\bu+m+\b/gi,
  /\bu+h+\b/gi,
  /\b(?:like|kind of|kinda|sort of|sorta)\b/gi,
  /\bactually\b/gi,
  /\bI mean\b/gi,
  /\bwait\b/gi,
  /\.{3,}/g, // long pauses commonly transcribed as "..."
]

// In-memory cache by call_id. Retell will sometimes deliver call_ended
// and call_analyzed for the same call within seconds, and the analyzed
// path re-extracts; cache prevents a duplicate Bedrock spend.
const CACHE_TTL_MS = 30 * 60 * 1000
const cache = new Map<string, { signals: ExtractedSignals; at: number }>()

// --- Public entry point ------------------------------------------------------

export async function extractSignals(args: ExtractSignalsArgs): Promise<ExtractedSignals> {
  const { callId, transcript } = args

  if (callId) {
    const hit = cache.get(callId)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.signals
  }

  if (!transcript || transcript.trim().length < 10) {
    const empty: ExtractedSignals = {
      no_show_intent: null,
      reschedule_intent: null,
      crisis_risk: null,
      sentiment_score: null,
      hesitation_count: null,
      hesitation_markers: [],
      key_phrases: [],
      confidence: null,
      source: 'empty',
      ai_used: false,
      fallback_reason: 'empty_or_too_short',
    }
    if (callId) cache.set(callId, { signals: empty, at: Date.now() })
    return empty
  }

  const truncated = truncateForLlm(transcript)

  // Layer (a): regex pass — cheap, deterministic, runs always.
  const regex = regexPass(transcript)

  // Layer (b): AI pass — runs even on regex-positive transcripts so we
  // get sentiment + key_phrases. Failures fall back to regex-only.
  let ai: AiExtractionResult | null = null
  let fallbackReason: string | undefined
  try {
    ai = await aiPass({
      transcript: truncated,
      patientFirstName: args.patientFirstName,
      callAnalysis: args.callAnalysis,
    })
  } catch (err) {
    fallbackReason = `ai_error:${(err as Error).message?.slice(0, 80) ?? 'unknown'}`
  }

  const signals = merge(regex, ai, fallbackReason)
  if (callId) cache.set(callId, { signals, at: Date.now() })
  return signals
}

/**
 * Test/debug helper. Lets callers force a re-extraction.
 */
export function clearSignalCache(callId?: string): void {
  if (callId) cache.delete(callId)
  else cache.clear()
}

// --- Layer (a): deterministic regex pass -------------------------------------

interface RegexResult {
  no_show_intent: boolean
  reschedule_intent: boolean
  crisis_risk: boolean
  hesitation_markers: HesitationMarker[]
  key_phrases: string[]
}

function regexPass(transcript: string): RegexResult {
  const noShow = CANCEL_REGEX.some((r) => r.test(transcript))
  const reschedule = RESCHEDULE_REGEX.some((r) => r.test(transcript))

  // Crisis: reuse the W37 IMMEDIATE_CRISIS_PHRASES list verbatim. These
  // are the unambiguous tier-1 phrases (suicide, self-harm intent,
  // finality signals) — same list the voice server's tripwire uses.
  const lower = transcript.toLowerCase()
  const crisis = IMMEDIATE_CRISIS_PHRASES.some((p) => lower.includes(p))

  const markers: HesitationMarker[] = []
  for (const r of HESITATION_REGEX) {
    let m: RegExpExecArray | null
    while ((m = r.exec(transcript)) !== null) {
      markers.push({ term: m[0].toLowerCase(), index: m.index })
      if (markers.length >= 200) break // safety cap
    }
    if (markers.length >= 200) break
  }

  const keyPhrases: string[] = []
  if (noShow) keyPhrases.push('explicit-cancel-marker')
  if (reschedule) keyPhrases.push('explicit-reschedule-marker')
  if (crisis) keyPhrases.push('tier1-crisis-phrase')

  return {
    no_show_intent: noShow,
    reschedule_intent: reschedule,
    crisis_risk: crisis,
    hesitation_markers: markers,
    key_phrases: keyPhrases,
  }
}

// --- Layer (b): Bedrock-augmented extraction --------------------------------

interface AiExtractionResult {
  no_show_intent: boolean | null
  reschedule_intent: boolean | null
  crisis_risk: boolean | null
  sentiment_score: number | null
  hesitation_count: number | null
  key_phrases: string[]
  confidence: number | null
}

async function aiPass(args: {
  transcript: string
  patientFirstName?: string | null
  callAnalysis?: ExtractSignalsArgs['callAnalysis']
}): Promise<AiExtractionResult> {
  const name = (args.patientFirstName || '').trim() || 'the patient'

  const system = [
    'You extract structured signals from receptionist call transcripts.',
    'You return ONLY a JSON object — no prose, no code fences, no commentary.',
    'You DO NOT hallucinate; if a field cannot be determined from the',
    'transcript, return null for that field. You extract only what was',
    'literally said. You do NOT interpret subtext or infer clinical meaning.',
  ].join(' ')

  const summaryHint = args.callAnalysis?.call_summary
    ? `\n\nRetell-provided call summary (for orientation, not authoritative):\n${args.callAnalysis.call_summary}`
    : ''
  const sentimentHint = args.callAnalysis?.user_sentiment
    ? `\n\nRetell-provided user sentiment label: ${args.callAnalysis.user_sentiment}`
    : ''

  const user = [
    `Receptionist call transcript with patient ${name}:`,
    '',
    args.transcript,
    summaryHint,
    sentimentHint,
    '',
    'Return a JSON object with exactly these fields:',
    '  no_show_intent     boolean | null  (did the patient mention intending to cancel/skip?)',
    '  reschedule_intent  boolean | null  (did the patient propose moving the appointment?)',
    '  crisis_risk        boolean | null  (any indication of self-harm, severe distress, or suicidal ideation?)',
    '  sentiment_score    number  | null  (-1.0 to +1.0; 0 = neutral; null if unclear)',
    '  hesitation_count   integer | null  (count of "um", "actually", long pauses, mid-sentence corrections)',
    '  key_phrases        string[]        (3-5 quoted phrases that informed the scores; empty array if none)',
    '  confidence         number  | null  (0.0 to 1.0)',
    '',
    'If the transcript is empty, unintelligible, or only system noise, return',
    'every field as null and key_phrases as []. Output ONLY the JSON.',
  ].join('\n')

  const resp = await createMessage({
    system,
    messages: [{ role: 'user', content: user }],
    max_tokens: 600,
    temperature: 0,
  })
  const text = resp.content.map((c) => c.text).join('').trim()
  return parseAiJson(text)
}

function parseAiJson(raw: string): AiExtractionResult {
  // Strip code fences if the model added them despite instructions.
  let s = raw.trim()
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  }
  // Pull the outermost JSON object if surrounded by stray prose.
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)

  let obj: any
  try {
    obj = JSON.parse(s)
  } catch (err) {
    throw new Error(`ai_returned_non_json: ${(err as Error).message.slice(0, 60)}`)
  }

  return {
    no_show_intent: nullableBool(obj.no_show_intent),
    reschedule_intent: nullableBool(obj.reschedule_intent),
    crisis_risk: nullableBool(obj.crisis_risk),
    sentiment_score: nullableNumber(obj.sentiment_score, -1, 1),
    hesitation_count: nullableInt(obj.hesitation_count, 0, 1000),
    key_phrases: Array.isArray(obj.key_phrases)
      ? obj.key_phrases
          .filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
          .slice(0, 8)
      : [],
    confidence: nullableNumber(obj.confidence, 0, 1),
  }
}

// --- Merge regex + ai --------------------------------------------------------

function merge(regex: RegexResult, ai: AiExtractionResult | null, fallback?: string): ExtractedSignals {
  if (!ai) {
    // AI failed — fall back to regex-only. Sentiment + confidence stay
    // null because we don't have a way to estimate them.
    return {
      no_show_intent: regex.no_show_intent,
      reschedule_intent: regex.reschedule_intent,
      crisis_risk: regex.crisis_risk,
      sentiment_score: null,
      hesitation_count: regex.hesitation_markers.length,
      hesitation_markers: regex.hesitation_markers,
      key_phrases: regex.key_phrases,
      confidence: null,
      source: 'regex_only',
      ai_used: false,
      fallback_reason: fallback ?? 'ai_unavailable',
    }
  }
  // OR-merge boolean flags: regex matches are always trustworthy (a
  // literal "kill myself" is crisis_risk=true even if the model said
  // otherwise). AI fills the booleans the regex couldn't determine.
  return {
    no_show_intent: regex.no_show_intent || ai.no_show_intent === true ? true : ai.no_show_intent ?? false,
    reschedule_intent: regex.reschedule_intent || ai.reschedule_intent === true ? true : ai.reschedule_intent ?? false,
    crisis_risk: regex.crisis_risk || ai.crisis_risk === true ? true : ai.crisis_risk ?? false,
    sentiment_score: ai.sentiment_score,
    hesitation_count: ai.hesitation_count ?? regex.hesitation_markers.length,
    hesitation_markers: regex.hesitation_markers,
    // Prefer AI key phrases (quoted from transcript); fall back to
    // regex-tagged sentinels.
    key_phrases: ai.key_phrases.length > 0 ? ai.key_phrases : regex.key_phrases,
    confidence: ai.confidence,
    source: 'regex+ai',
    ai_used: true,
  }
}

// --- helpers -----------------------------------------------------------------

function truncateForLlm(transcript: string): string {
  if (transcript.length <= MAX_TRANSCRIPT_CHARS) return transcript
  const half = Math.floor(MAX_TRANSCRIPT_CHARS / 2)
  const head = transcript.slice(0, half)
  const tail = transcript.slice(transcript.length - half)
  return `${head}\n\n[...transcript truncated for length...]\n\n${tail}`
}

function nullableBool(v: unknown): boolean | null {
  if (v === true || v === false) return v
  return null
}

function nullableNumber(v: unknown, lo: number, hi: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  if (v < lo) return lo
  if (v > hi) return hi
  return v
}

function nullableInt(v: unknown, lo: number, hi: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const n = Math.round(v)
  if (n < lo) return lo
  if (n > hi) return hi
  return n
}
