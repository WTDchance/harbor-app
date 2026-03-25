// Crisis Detection Tripwire for Harbor Voice AI
// Lightweight pattern matching that runs on every utterance (basically free).
// When triggered, escalates to Claude Sonnet for deep emotional analysis.

import Anthropic from '@anthropic-ai/sdk'

// ── Tier 1: Immediate escalation (no LLM needed) ──────────────────────────
// These are unambiguous crisis signals. If detected, skip Sonnet and escalate immediately.
const IMMEDIATE_CRISIS_PHRASES = [
  'kill myself', 'end my life', 'take my own life', 'suicide',
  'suicidal', 'want to die', 'rather be dead', 'better off dead',
  'ending it all', 'going to hurt myself', 'going to harm myself',
  'overdose', 'slit my wrist', 'jump off', 'hang myself',
  'shoot myself', 'not going to be around', 'final goodbye',
  "won't be here tomorrow", 'no reason to live', 'nothing to live for',
  'planning to end', 'goodbye forever',
]

// ── Tier 2: Tripwire phrases (trigger Sonnet analysis) ─────────────────────
// These are ambiguous but concerning. Could be crisis, could be normal conversation.
// When detected, we send the full transcript to Sonnet for contextual analysis.
const TRIPWIRE_PHRASES = [
  // Indirect crisis language
  "don't want to be here", "can't do this anymore", "can't go on",
  "don't see the point", "what's the point", 'tired of everything',
  'tired of trying', 'given up', 'no hope', 'hopeless', 'worthless',
  'no one cares', 'no one would miss me', "doesn't matter anymore",
  'just want it to stop', 'just want the pain to stop',
  'make it stop', "can't take it",

  // Behavioral warning signs (receptionist context)
  'cancel all my appointments', 'cancel everything',
  'giving away', 'getting my affairs in order',
  'wanted to make sure you have', 'just in case',
  'tell my therapist goodbye', 'last session',

  // Escalating distress
  'panic attack', 'can\'t breathe', 'can\'t stop crying',
  'haven\'t slept in days', 'not eating', 'stopped eating',
  'drinking too much', 'using again', 'relapsed',
  'voices', 'hearing things', 'seeing things',
  'paranoid', 'following me', 'watching me',
]

// ── Tier 3: Contextual patterns (multi-turn detection) ─────────────────────
// These aren't phrases but behavioral patterns across the conversation.
const CONTEXT_PATTERNS = {
  // Patient cancels multiple future appointments in one call
  multipleCancellations: /cancel.*(?:all|every|rest of|remaining|next \d+)/i,
  // Patient asks to relay a final-sounding message
  relayGoodbye: /(?:tell|let|have).*(?:therapist|doctor|counselor).*(?:know|goodbye|thank|appreciate|meant a lot)/i,
  // Patient sounds like they're settling affairs
  settlingAffairs: /(?:insurance|beneficiary|emergency contact|records|files).*(?:updated?|changed?|make sure|just in case)/i,
}

export interface CrisisAssessment {
  level: 'none' | 'monitor' | 'concern' | 'crisis'
  immediate: boolean
  triggerPhrases: string[]
  sonnetAnalysis?: string
  recommendedAction: 'continue' | 'gentle_checkin' | 'escalate_therapist' | 'crisis_protocol'
}

/**
 * Tier 1 + 2: Fast pattern matching on a single utterance.
 * Runs synchronously, costs nothing. Called on every patient message.
 */
export function scanUtterance(utterance: string): {
  immediateCrisis: boolean
  tripwireTriggered: boolean
  matchedPhrases: string[]
} {
  const lower = utterance.toLowerCase()

  // Check Tier 1: Immediate crisis
  const immediateMatches = IMMEDIATE_CRISIS_PHRASES.filter(phrase =>
    lower.includes(phrase)
  )
  if (immediateMatches.length > 0) {
    return {
      immediateCrisis: true,
      tripwireTriggered: true,
      matchedPhrases: immediateMatches,
    }
  }

  // Check Tier 2: Tripwire phrases
  const tripwireMatches = TRIPWIRE_PHRASES.filter(phrase =>
    lower.includes(phrase)
  )

  // Check Tier 3: Contextual patterns
  const contextMatches = Object.entries(CONTEXT_PATTERNS)
    .filter(([_, pattern]) => pattern.test(utterance))
    .map(([name]) => `[pattern:${name}]`)

  const allMatches = [...tripwireMatches, ...contextMatches]

  return {
    immediateCrisis: false,
    tripwireTriggered: allMatches.length > 0,
    matchedPhrases: allMatches,
  }
}

/**
 * Tier 3: Deep analysis via Claude Sonnet.
 * Only called when the tripwire fires. Analyzes the FULL conversation transcript
 * to determine if this is a genuine crisis or a false positive.
 *
 * Cost: ~$0.01-0.03 per call (only on flagged conversations)
 */
export async function analyzeWithSonnet(
  transcript: string,
  triggerPhrases: string[],
  practiceContext: { therapistName: string; practiceName: string }
): Promise<CrisisAssessment> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set — defaulting to escalation for safety')
    return {
      level: 'concern',
      immediate: false,
      triggerPhrases,
      recommendedAction: 'escalate_therapist',
      sonnetAnalysis: 'Unable to perform deep analysis — API key missing. Escalating as precaution.',
    }
  }

  const anthropic = new Anthropic({ apiKey })

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `You are a crisis assessment specialist analyzing a phone call transcript from a therapy practice receptionist system.

CONTEXT:
- Practice: ${practiceContext.practiceName}
- Therapist: ${practiceContext.therapistName}
- The caller is speaking with an AI receptionist
- Trigger phrases detected: ${triggerPhrases.join(', ')}

TRANSCRIPT:
${transcript}

Analyze this conversation and assess the caller's safety risk. Consider:
1. Are the trigger phrases used in a crisis context, or innocuous? (e.g., "cancel all appointments" could mean they're switching providers, not crisis)
2. Is there escalating emotional distress across the conversation?
3. Are there indirect warning signs (settling affairs, final goodbyes, giving things away)?
4. What is the overall emotional trajectory — improving, stable, or deteriorating?

Respond in this exact JSON format:
{
  "level": "none|monitor|concern|crisis",
  "reasoning": "1-2 sentence explanation",
  "recommended_action": "continue|gentle_checkin|escalate_therapist|crisis_protocol",
  "suggested_response": "If action is gentle_checkin, provide a warm sentence the receptionist should say"
}

IMPORTANT: When in doubt, err on the side of safety. A false positive (unnecessary therapist alert) is far better than a missed crisis.`,
        },
      ],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''

    // Parse the JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('Sonnet returned non-JSON response, escalating as precaution')
      return {
        level: 'concern',
        immediate: false,
        triggerPhrases,
        recommendedAction: 'escalate_therapist',
        sonnetAnalysis: text,
      }
    }

    const analysis = JSON.parse(jsonMatch[0])

    return {
      level: analysis.level || 'concern',
      immediate: analysis.level === 'crisis',
      triggerPhrases,
      recommendedAction: analysis.recommended_action || 'escalate_therapist',
      sonnetAnalysis: analysis.reasoning,
    }
  } catch (error) {
    console.error('Sonnet analysis failed:', error)
    // Fail safe: if we can't analyze, escalate
    return {
      level: 'concern',
      immediate: false,
      triggerPhrases,
      recommendedAction: 'escalate_therapist',
      sonnetAnalysis: 'Analysis failed — escalating as precaution.',
    }
  }
}

/**
 * Get the crisis response text to inject into the conversation
 * when immediate crisis is detected (Tier 1).
 */
export function getCrisisResponse(therapistName: string): string {
  return `I'm really glad you called, and I want you to know that what you're feeling matters. Your safety is the most important thing right now. Please reach out to the 988 Suicide and Crisis Lifeline — you can call or text 988, and they're available 24/7. If you're in immediate danger, please call 911. I'm making a note right now for ${therapistName} to follow up with you personally today. You're not alone in this.`
}

/**
 * Get a gentle check-in response for Tier 2 concerns.
 * Used when Sonnet recommends a soft emotional check.
 */
export function getGentleCheckinResponse(therapistName: string, sonnetSuggestion?: string): string {
  if (sonnetSuggestion) return sonnetSuggestion
  return `I want to check in with you — it sounds like you might be going through a tough time. Are you doing okay? ${therapistName} really cares about you, and I want to make sure you have the support you need.`
}
