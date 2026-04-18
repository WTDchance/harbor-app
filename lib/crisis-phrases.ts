// ═══════════════════════════════════════════════════════════════════════════
// Harbor Crisis Detection — Shared Phrase Lists
// ═══════════════════════════════════════════════════════════════════════════
// These lists are the canonical source for crisis detection in the Next.js app.
// The voice server (voice-server/src/crisis-tripwire.ts) maintains its own copy
// with an identical Tier 1 list + additional Tier 2/3 layers that leverage
// Claude Sonnet for contextual analysis.
//
// IMPORTANT: If you update IMMEDIATE_CRISIS_PHRASES here, update the voice
// server's copy too. They must stay in sync.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tier 1: Unambiguous crisis language.
 * These phrases have virtually zero false-positive risk in a therapy context.
 * When detected, immediately alert the therapist via SMS — no LLM needed.
 */
export const IMMEDIATE_CRISIS_PHRASES = [
  // Direct suicidal ideation
  'kill myself', 'end my life', 'take my own life', 'suicide',
  'suicidal', 'want to die', 'rather be dead', 'better off dead',
  'ending it all', 'planning to end',

  // Self-harm intent
  'going to hurt myself', 'going to harm myself',
  'hurt myself', 'harm myself', 'cut myself',
  'slit my wrist', 'shoot myself', 'hang myself', 'overdose',

  // Finality signals
  'not going to be around', 'final goodbye', 'goodbye forever',
  "won't be here tomorrow", 'no reason to live', 'nothing to live for',
  'not worth living',
] as const

/**
 * Tier 2: Ambiguous but concerning language.
 * These COULD indicate crisis but also appear in normal conversation.
 * In the voice server, these trigger Sonnet analysis for context.
 * In the API route, these are NOT used for immediate alerts — only logged
 * for awareness. A therapist doesn't need a 2am SMS because someone said
 * "I feel hopeless about finding a good appointment time."
 *
 * These are exported for reference/logging but should NOT trigger SMS alerts
 * without additional contextual analysis.
 */
export const CONCERN_PHRASES = [
  // Indirect distress
  "don't want to be here", "can't do this anymore", "can't go on",
  "don't see the point", "what's the point", 'tired of everything',
  'tired of trying', 'given up', 'no hope', 'hopeless', 'worthless',
  'no one cares', 'no one would miss me', "doesn't matter anymore",
  'just want it to stop', 'just want the pain to stop',
  'make it stop', "can't take it", 'want it to end',

  // Behavioral warning signs
  'cancel all my appointments', 'cancel everything',
  'giving away', 'getting my affairs in order',
  'tell my therapist goodbye', 'last session',

  // Escalating distress
  'panic attack', "can't breathe", "can't stop crying",
  "haven't slept in days", 'not eating', 'stopped eating',
  'drinking too much', 'using again', 'relapsed',
  'voices', 'hearing things', 'seeing things',
  'paranoid', 'following me', 'watching me',
] as const

/**
 * Detect crisis phrases in text.
 * Returns both immediate (Tier 1) and concern (Tier 2) matches separately
 * so callers can decide how to handle each level.
 */
export function detectCrisis(text: string): {
  immediateCrisis: boolean
  concernDetected: boolean
  immediateMatches: string[]
  concernMatches: string[]
} {
  const lower = text.toLowerCase()

  const immediateMatches = IMMEDIATE_CRISIS_PHRASES.filter(p => lower.includes(p))
  const concernMatches = CONCERN_PHRASES.filter(p => lower.includes(p))

  return {
    immediateCrisis: immediateMatches.length > 0,
    concernDetected: concernMatches.length > 0,
    immediateMatches: [...immediateMatches],
    concernMatches: [...concernMatches],
  }
}
