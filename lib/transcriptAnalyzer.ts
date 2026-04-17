// Transcript analyzer for post-call enrichment
// Parses call transcripts to extract structured signals for the AI data moat.
// Designed to run synchronously (no LLM calls) for speed — the heavy-lifting
// AI enrichment (sentiment, engagement) runs as a separate async step.

export interface TranscriptMetrics {
  // Talk time breakdown (estimated from character count × speech rate)
  callerTalkSeconds: number
  aiTalkSeconds: number
  totalTalkSeconds: number

  // Turn counting
  turnCount: number        // Number of caller utterances
  aiTurnCount: number      // Number of AI utterances
  avgCallerTurnLength: number  // Average words per caller turn

  // Call outcome detection
  callOutcome: 'booked' | 'message_taken' | 'info_only' | 'hung_up' | 'voicemail' | 'crisis_referral' | 'no_interaction' | 'intake_collected'
  isNewPatient: boolean

  // Booking tracking
  bookingAttempted: boolean
  bookingSucceeded: boolean

  // Topic extraction
  topicsDiscussed: string[]
}

// Average speaking rate: ~150 words per minute (2.5 words/sec)
// Average word length in English: ~5 characters
// So roughly 12.5 characters per second of speech
const CHARS_PER_SECOND = 12.5

/**
 * Parse a Harbor-format transcript into AI and Caller turns.
 * Format: "AI: ...\nUser: ...\nAI: ..." (or "Caller: ...")
 */
function parseTurns(transcript: string): Array<{ role: 'ai' | 'caller'; text: string }> {
  const turns: Array<{ role: 'ai' | 'caller'; text: string }> = []
  // Split on "AI:" or "User:" or "Caller:" at the start of a line
  const segments = transcript.split(/\n(?=(?:AI|User|Caller):)/i)

  for (const segment of segments) {
    const trimmed = segment.trim()
    if (!trimmed) continue

    if (/^AI:/i.test(trimmed)) {
      turns.push({ role: 'ai', text: trimmed.replace(/^AI:\s*/i, '').trim() })
    } else if (/^(?:User|Caller):/i.test(trimmed)) {
      turns.push({ role: 'caller', text: trimmed.replace(/^(?:User|Caller):\s*/i, '').trim() })
    }
  }

  return turns
}

/**
 * Estimate talk time in seconds from text length.
 */
function estimateTalkTime(text: string): number {
  return Math.round(text.length / CHARS_PER_SECOND)
}

/**
 * Detect call outcome from transcript content.
 */
function detectCallOutcome(transcript: string, turns: Array<{ role: 'ai' | 'caller'; text: string }>): TranscriptMetrics['callOutcome'] {
  const lower = transcript.toLowerCase()

  // No caller interaction at all
  const callerTurns = turns.filter(t => t.role === 'caller')
  if (callerTurns.length === 0) return 'no_interaction'

  // Crisis referral (988 mentioned by AI)
  const aiText = turns.filter(t => t.role === 'ai').map(t => t.text.toLowerCase()).join(' ')
  if (aiText.includes('988') || aiText.includes('suicide and crisis lifeline')) {
    return 'crisis_referral'
  }

  // Booking succeeded
  if (
    lower.includes('appointment is confirmed') ||
    lower.includes('you\'re all set') ||
    lower.includes('appointment is booked') ||
    lower.includes('added to the calendar') ||
    lower.includes('we\'ll see you')
  ) {
    return 'booked'
  }

  // Message taken
  if (
    lower.includes('message to') ||
    lower.includes('get that message') ||
    lower.includes('your message has been') ||
    lower.includes('callback') ||
    lower.includes('call you back')
  ) {
    return 'message_taken'
  }

  // Intake was collected (has scheduling keywords but not confirmed)
  if (
    lower.includes('intake') ||
    lower.includes('screening questions') ||
    lower.includes('paperwork')
  ) {
    return 'intake_collected'
  }

  // Info-only call
  if (
    lower.includes('just curious') ||
    lower.includes('just wondering') ||
    lower.includes('information') ||
    callerTurns.length <= 3
  ) {
    return 'info_only'
  }

  // Hung up (ended abruptly with short last caller turn)
  const lastCallerTurn = callerTurns[callerTurns.length - 1]
  if (lastCallerTurn && lastCallerTurn.text.length < 20 && !lower.includes('thank')) {
    return 'hung_up'
  }

  return 'info_only'
}

/**
 * Detect if this is a new patient call.
 */
function detectNewPatient(transcript: string): boolean {
  const lower = transcript.toLowerCase()
  // Explicit signals
  if (lower.includes('new patient') || lower.includes('first time') || lower.includes('first appointment')) {
    return true
  }
  if (lower.includes('returning patient') || lower.includes('established patient') || lower.includes('been here before') || lower.includes('been a patient')) {
    return false
  }
  // Default: if intake/scheduling language is present, likely new
  if (lower.includes('intake') || lower.includes('screening questions')) {
    return true
  }
  return false // conservative default
}

/**
 * Detect if booking was attempted.
 */
function detectBookingAttempted(transcript: string): boolean {
  const lower = transcript.toLowerCase()
  return (
    lower.includes('check') && lower.includes('availability') ||
    lower.includes('let me check') && lower.includes('schedule') ||
    lower.includes('calendar') ||
    lower.includes('open slot') ||
    lower.includes('opening') && lower.includes('appointment') ||
    lower.includes('book') && lower.includes('appointment')
  )
}

/**
 * Detect if booking succeeded.
 */
function detectBookingSucceeded(transcript: string): boolean {
  const lower = transcript.toLowerCase()
  return (
    lower.includes('appointment is confirmed') ||
    lower.includes('you\'re all set') ||
    lower.includes('added to the calendar') ||
    lower.includes('appointment is booked')
  )
}

// Topic detection keywords mapped to topic labels
const TOPIC_PATTERNS: Array<{ topic: string; patterns: string[] }> = [
  { topic: 'scheduling', patterns: ['schedule', 'appointment', 'book', 'available', 'opening', 'slot'] },
  { topic: 'insurance', patterns: ['insurance', 'medicaid', 'self pay', 'self-pay', 'out of pocket', 'copay'] },
  { topic: 'anxiety', patterns: ['anxiety', 'anxious', 'nervous', 'worry', 'worrying', 'panic', 'on edge'] },
  { topic: 'depression', patterns: ['depress', 'hopeless', 'down', 'sad', 'no interest', 'no pleasure'] },
  { topic: 'trauma', patterns: ['trauma', 'ptsd', 'abuse', 'assault', 'accident'] },
  { topic: 'crisis', patterns: ['suicide', 'self-harm', 'kill myself', 'end my life', '988', 'crisis'] },
  { topic: 'telehealth', patterns: ['telehealth', 'video', 'virtual', 'online', 'remote'] },
  { topic: 'in_person', patterns: ['in person', 'in-person', 'come in', 'office', 'location'] },
  { topic: 'medication', patterns: ['medication', 'meds', 'prescribe', 'prescription'] },
  { topic: 'couples', patterns: ['couple', 'marriage', 'relationship', 'partner', 'spouse'] },
  { topic: 'family', patterns: ['family', 'child', 'children', 'parenting', 'teenager'] },
  { topic: 'substance_use', patterns: ['alcohol', 'drinking', 'drug', 'substance', 'addiction', 'sober'] },
  { topic: 'grief', patterns: ['grief', 'loss', 'death', 'died', 'passing', 'mourning'] },
  { topic: 'sleep', patterns: ['sleep', 'insomnia', 'nightmares', 'can\'t sleep'] },
  { topic: 'stress', patterns: ['stress', 'overwhelm', 'burnout', 'exhausted'] },
  { topic: 'intake_forms', patterns: ['intake', 'paperwork', 'forms', 'questionnaire'] },
  { topic: 'cancellation', patterns: ['cancel', 'reschedule', 'change', 'move my appointment'] },
  { topic: 'billing', patterns: ['bill', 'cost', 'price', 'how much', 'fee', 'payment'] },
]

/**
 * Extract discussed topics from transcript.
 */
function extractTopics(transcript: string): string[] {
  const lower = transcript.toLowerCase()
  const topics: string[] = []

  for (const { topic, patterns } of TOPIC_PATTERNS) {
    if (patterns.some(p => lower.includes(p))) {
      topics.push(topic)
    }
  }

  return topics
}

/**
 * Main analysis function — runs synchronously, no API calls.
 * Returns structured metrics for every call.
 */
export function analyzeTranscript(transcript: string): TranscriptMetrics {
  const turns = parseTurns(transcript)
  const callerTurns = turns.filter(t => t.role === 'caller')
  const aiTurns = turns.filter(t => t.role === 'ai')

  const callerText = callerTurns.map(t => t.text).join(' ')
  const aiText = aiTurns.map(t => t.text).join(' ')

  const callerTalkSeconds = estimateTalkTime(callerText)
  const aiTalkSeconds = estimateTalkTime(aiText)

  const callerWordCount = callerText.split(/\s+/).filter(Boolean).length
  const avgCallerTurnLength = callerTurns.length > 0
    ? Math.round(callerWordCount / callerTurns.length)
    : 0

  return {
    callerTalkSeconds,
    aiTalkSeconds,
    totalTalkSeconds: callerTalkSeconds + aiTalkSeconds,
    turnCount: callerTurns.length,
    aiTurnCount: aiTurns.length,
    avgCallerTurnLength,
    callOutcome: detectCallOutcome(transcript, turns),
    isNewPatient: detectNewPatient(transcript),
    bookingAttempted: detectBookingAttempted(transcript),
    bookingSucceeded: detectBookingSucceeded(transcript),
    topicsDiscussed: extractTopics(transcript),
  }
}
