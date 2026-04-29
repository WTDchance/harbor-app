// lib/aws/retell/extract-call-signals.ts
//
// W50 D2 — per-utterance signal extraction over a call transcript.
// Two layers:
//   * regex (synchronous, cheap) — crisis keywords, names, DOBs,
//     phone confirmations, insurance mentions, urgency phrases.
//   * Bedrock (asynchronous, optional) — Claude reads the full
//     transcript and returns sentiment/hesitation/urgency/dropout_risk
//     plus a free-text summary.
//
// Returns rows ready to insert into ehr_call_signals. Pure function;
// caller persists.

export type CallSignalType =
  | 'intent'
  | 'hesitation'
  | 'urgency_low'
  | 'urgency_medium'
  | 'urgency_high'
  | 'crisis_flag'
  | 'name_candidate'
  | 'dob_candidate'
  | 'phone_confirmation'
  | 'insurance_mention'
  | 'scheduling_intent'
  | 'scheduling_friction'
  | 'sentiment_positive'
  | 'sentiment_negative'
  | 'dropout_signal'
  | 'payment_concern'

export interface ExtractedCallSignal {
  signal_type: CallSignalType
  signal_value: string | null
  confidence: number
  raw_excerpt: string | null
  extracted_by: 'regex' | 'bedrock'
}

// ────────────────────────────────────────────────────────────────────
// Regex layer
// ────────────────────────────────────────────────────────────────────

const CRISIS_PATTERNS: Array<RegExp> = [
  /\b(kill myself|killing myself|kill ?my ?self)\b/i,
  /\b(end (it|my life)|take my life|hurt myself)\b/i,
  /\b(suicid(?:e|al))\b/i,
  /\b(overdose|overdosing)\b/i,
  /\b(don'?t want to (be|live) anymore)\b/i,
  /\b(no reason to live|nothing to live for)\b/i,
]

const URGENCY_HIGH_PATTERNS: Array<RegExp> = [
  /\b(right now|immediately|emergency|right away|urgent(ly)?|asap|today)\b/i,
  /\b(can'?t wait|need someone now)\b/i,
]
const URGENCY_MED_PATTERNS: Array<RegExp> = [
  /\b(this week|in a few days|soon as possible|as soon as)\b/i,
]
const URGENCY_LOW_PATTERNS: Array<RegExp> = [
  /\b(no rush|whenever|next month|sometime)\b/i,
]

const HESITATION_PATTERNS: Array<RegExp> = [
  /\b(uh+|um+|er+|hmm+)\b/i,
  /\b(i'?m not sure|maybe|kind of|sort of|i don'?t know|idk)\b/i,
  /\b(i guess|i suppose)\b/i,
]

const SCHEDULING_INTENT: Array<RegExp> = [
  /\b(book|schedule|set up|make) (an )?appointment\b/i,
  /\b(want|like|need) to (see|meet) (a |someone|someone)\b/i,
  /\b(do you have (any )?(times|openings|availability))\b/i,
]
const SCHEDULING_FRICTION: Array<RegExp> = [
  /\b(that doesn'?t work|won'?t work for me|can'?t do that time)\b/i,
  /\b(none of those (times|work))\b/i,
]

const PAYMENT_CONCERN: Array<RegExp> = [
  /\b(how much (does|will) (it|this) cost|price|payment|copay|deductible)\b/i,
  /\b(can'?t afford|too expensive|out of (my )?budget)\b/i,
  /\b(do you take .* insurance)\b/i,
]

const DROPOUT_SIGNAL: Array<RegExp> = [
  /\b(cancel (all )?my appointments?|stop (coming|the sessions))\b/i,
  /\b(don'?t need (this|therapy) anymore|i'?m done)\b/i,
]

// Capture groups
const NAME_PATTERN = /\b(?:my name is|this is|i(?:'m| am)) ([A-Z][a-zA-Z'-]+(?: [A-Z][a-zA-Z'-]+)?)\b/i
const DOB_PATTERN = /\b((?:0?[1-9]|1[0-2])[\/\-.](?:0?[1-9]|[12]\d|3[01])[\/\-.](?:19|20)?\d{2})\b/
const PHONE_PATTERN = /\b((?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4})\b/

const INSURANCE_PATTERN = /\b(aetna|blue cross|blue shield|bcbs|cigna|united(?:\s?healthcare)?|kaiser|humana|anthem|medicaid|medicare|tricare|providence|regence|moda)\b/i

const POSITIVE_SENTIMENT: Array<RegExp> = [
  /\b(great|excellent|wonderful|so glad|appreciate|thank you so much)\b/i,
]
const NEGATIVE_SENTIMENT: Array<RegExp> = [
  /\b(angry|frustrated|upset|disappointed|terrible|worst|hate|hating)\b/i,
]

function findAll(text: string, patterns: RegExp[]): RegExpMatchArray[] {
  const out: RegExpMatchArray[] = []
  for (const p of patterns) {
    const flags = p.flags.includes('g') ? p.flags : p.flags + 'g'
    const re = new RegExp(p.source, flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      out.push(m as unknown as RegExpMatchArray)
      if (m.index === re.lastIndex) re.lastIndex++
    }
  }
  return out
}

function excerptAround(text: string, idx: number, len: number, ctx = 60): string {
  const start = Math.max(0, idx - ctx)
  const end = Math.min(text.length, idx + len + ctx)
  return text.slice(start, end).trim()
}

export function extractRegexSignals(transcript: string): ExtractedCallSignal[] {
  if (!transcript || transcript.length < 5) return []
  const out: ExtractedCallSignal[] = []

  for (const m of findAll(transcript, CRISIS_PATTERNS)) {
    out.push({
      signal_type: 'crisis_flag',
      signal_value: m[0],
      confidence: 0.95,
      raw_excerpt: excerptAround(transcript, m.index ?? 0, m[0].length),
      extracted_by: 'regex',
    })
  }

  for (const m of findAll(transcript, URGENCY_HIGH_PATTERNS)) {
    out.push({ signal_type: 'urgency_high', signal_value: m[0], confidence: 0.7, raw_excerpt: excerptAround(transcript, m.index ?? 0, m[0].length), extracted_by: 'regex' })
  }
  for (const m of findAll(transcript, URGENCY_MED_PATTERNS)) {
    out.push({ signal_type: 'urgency_medium', signal_value: m[0], confidence: 0.6, raw_excerpt: excerptAround(transcript, m.index ?? 0, m[0].length), extracted_by: 'regex' })
  }
  for (const m of findAll(transcript, URGENCY_LOW_PATTERNS)) {
    out.push({ signal_type: 'urgency_low', signal_value: m[0], confidence: 0.5, raw_excerpt: excerptAround(transcript, m.index ?? 0, m[0].length), extracted_by: 'regex' })
  }

  // Hesitation: count occurrences and emit a single signal with the count.
  const hesMatches = findAll(transcript, HESITATION_PATTERNS)
  if (hesMatches.length > 0) {
    out.push({
      signal_type: 'hesitation',
      signal_value: String(hesMatches.length),
      confidence: Math.min(1, 0.4 + hesMatches.length * 0.05),
      raw_excerpt: excerptAround(transcript, hesMatches[0].index ?? 0, hesMatches[0][0].length),
      extracted_by: 'regex',
    })
  }

  for (const m of findAll(transcript, SCHEDULING_INTENT)) {
    out.push({ signal_type: 'scheduling_intent', signal_value: m[0], confidence: 0.75, raw_excerpt: excerptAround(transcript, m.index ?? 0, m[0].length), extracted_by: 'regex' })
  }
  for (const m of findAll(transcript, SCHEDULING_FRICTION)) {
    out.push({ signal_type: 'scheduling_friction', signal_value: m[0], confidence: 0.7, raw_excerpt: excerptAround(transcript, m.index ?? 0, m[0].length), extracted_by: 'regex' })
  }

  for (const m of findAll(transcript, PAYMENT_CONCERN)) {
    out.push({ signal_type: 'payment_concern', signal_value: m[0], confidence: 0.6, raw_excerpt: excerptAround(transcript, m.index ?? 0, m[0].length), extracted_by: 'regex' })
  }
  for (const m of findAll(transcript, DROPOUT_SIGNAL)) {
    out.push({ signal_type: 'dropout_signal', signal_value: m[0], confidence: 0.7, raw_excerpt: excerptAround(transcript, m.index ?? 0, m[0].length), extracted_by: 'regex' })
  }

  for (const m of findAll(transcript, POSITIVE_SENTIMENT)) {
    out.push({ signal_type: 'sentiment_positive', signal_value: m[0], confidence: 0.55, raw_excerpt: excerptAround(transcript, m.index ?? 0, m[0].length), extracted_by: 'regex' })
  }
  for (const m of findAll(transcript, NEGATIVE_SENTIMENT)) {
    out.push({ signal_type: 'sentiment_negative', signal_value: m[0], confidence: 0.55, raw_excerpt: excerptAround(transcript, m.index ?? 0, m[0].length), extracted_by: 'regex' })
  }

  // Single-shot capture patterns (name/DOB/phone/insurance).
  const nameMatch = NAME_PATTERN.exec(transcript)
  if (nameMatch && nameMatch[1]) {
    out.push({
      signal_type: 'name_candidate',
      signal_value: nameMatch[1].trim(),
      confidence: 0.7,
      raw_excerpt: excerptAround(transcript, nameMatch.index, nameMatch[0].length),
      extracted_by: 'regex',
    })
  }
  const dobMatch = DOB_PATTERN.exec(transcript)
  if (dobMatch && dobMatch[1]) {
    out.push({
      signal_type: 'dob_candidate',
      signal_value: dobMatch[1],
      confidence: 0.6,
      raw_excerpt: excerptAround(transcript, dobMatch.index, dobMatch[0].length),
      extracted_by: 'regex',
    })
  }
  const phoneMatch = PHONE_PATTERN.exec(transcript)
  if (phoneMatch && phoneMatch[1]) {
    out.push({
      signal_type: 'phone_confirmation',
      signal_value: phoneMatch[1].replace(/\D/g, ''),
      confidence: 0.65,
      raw_excerpt: excerptAround(transcript, phoneMatch.index, phoneMatch[0].length),
      extracted_by: 'regex',
    })
  }
  const insMatch = INSURANCE_PATTERN.exec(transcript)
  if (insMatch && insMatch[0]) {
    out.push({
      signal_type: 'insurance_mention',
      signal_value: insMatch[0].replace(/\b\w/g, c => c.toUpperCase()),
      confidence: 0.65,
      raw_excerpt: excerptAround(transcript, insMatch.index, insMatch[0].length),
      extracted_by: 'regex',
    })
  }

  return out
}

// ────────────────────────────────────────────────────────────────────
// Bedrock layer (optional augmentation)
// ────────────────────────────────────────────────────────────────────

export interface BedrockSignalSummary {
  sentiment: number      // -1..1
  hesitation_score: number // 0..1
  urgency: number        // 0..1
  dropout_risk: number   // 0..1
  summary: string
}

export const BEDROCK_PROMPT = `You are analyzing a single phone call transcript between an AI receptionist (Ellie) and a patient or prospective patient at a therapy practice. Return JSON ONLY with this shape, no prose:
{
  "sentiment": <number from -1 to 1, where -1 is very upset/negative, 0 is neutral, 1 is very positive>,
  "hesitation_score": <number from 0 to 1, where 0 = decisive caller, 1 = very hesitant>,
  "urgency": <number from 0 to 1, where 1 = immediate need, 0 = no rush>,
  "dropout_risk": <number from 0 to 1, where 1 = caller likely to discontinue therapy>,
  "summary": "<one sentence under 30 words>"
}
Strictly numeric values; no commentary outside the JSON.`

/**
 * Convert a Bedrock summary into one or more ehr_call_signals rows. The
 * Bedrock layer adds breadth (sentiment / dropout) without duplicating
 * what regex already catches — caller dedupes by signal_type if needed.
 */
export function bedrockSummaryToSignals(s: BedrockSignalSummary): ExtractedCallSignal[] {
  const out: ExtractedCallSignal[] = []

  if (s.sentiment >= 0.3) {
    out.push({ signal_type: 'sentiment_positive', signal_value: s.sentiment.toFixed(2), confidence: Math.min(1, Math.abs(s.sentiment)), raw_excerpt: s.summary, extracted_by: 'bedrock' })
  } else if (s.sentiment <= -0.3) {
    out.push({ signal_type: 'sentiment_negative', signal_value: s.sentiment.toFixed(2), confidence: Math.min(1, Math.abs(s.sentiment)), raw_excerpt: s.summary, extracted_by: 'bedrock' })
  }

  if (s.urgency >= 0.7) {
    out.push({ signal_type: 'urgency_high', signal_value: s.urgency.toFixed(2), confidence: s.urgency, raw_excerpt: s.summary, extracted_by: 'bedrock' })
  } else if (s.urgency >= 0.4) {
    out.push({ signal_type: 'urgency_medium', signal_value: s.urgency.toFixed(2), confidence: s.urgency, raw_excerpt: s.summary, extracted_by: 'bedrock' })
  } else if (s.urgency > 0) {
    out.push({ signal_type: 'urgency_low', signal_value: s.urgency.toFixed(2), confidence: 1 - s.urgency, raw_excerpt: s.summary, extracted_by: 'bedrock' })
  }

  if (s.hesitation_score >= 0.4) {
    out.push({ signal_type: 'hesitation', signal_value: s.hesitation_score.toFixed(2), confidence: s.hesitation_score, raw_excerpt: s.summary, extracted_by: 'bedrock' })
  }

  if (s.dropout_risk >= 0.5) {
    out.push({ signal_type: 'dropout_signal', signal_value: s.dropout_risk.toFixed(2), confidence: s.dropout_risk, raw_excerpt: s.summary, extracted_by: 'bedrock' })
  }

  return out
}

export function hasCrisisSignal(signals: ExtractedCallSignal[]): boolean {
  return signals.some(s => s.signal_type === 'crisis_flag')
}
