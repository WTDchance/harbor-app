// Voice-optimized system prompt builder for Harbor AI Receptionist
// Adapted from the main Harbor system prompt, tuned for real-time voice conversation.
// Key differences from the text prompt:
//   - Shorter, more conversational phrasing (voice is ephemeral, can't re-read)
//   - Explicit instructions about pacing, pauses, and natural speech patterns
//   - No markdown/formatting (this is spoken, not displayed)
//   - Crisis response wording optimized for spoken delivery

export interface PracticeConfig {
  // ── Core (required) ──
  therapist_name: string
  practice_name: string

  // ── Identity ──
  ai_name?: string
  therapist_title?: string            // "Dr.", "Licensed Counselor", etc.
  therapist_pronouns?: string         // "she/her", "he/him", "they/them"
  practice_vibe?: string              // "warm and casual", "professional and structured"
  receptionist_personality?: string   // how the AI should come across

  // ── Services & approach ──
  specialties?: string[]
  populations_served?: string[]       // "adults", "couples", "teens", "children"
  modalities?: string[]               // "CBT", "EMDR", "psychodynamic", "DBT"
  languages?: string[]

  // ── Scheduling (the #1 caller question) ──
  hours?: string
  session_length_minutes?: number
  booking_lead_days?: number          // how far out they're typically booked
  new_patient_callback_time?: string  // "within one business day", "within 24 hours"
  evening_weekend_available?: boolean
  intake_process_notes?: string       // what happens at first appointment

  // ── Location & logistics ──
  location?: string
  parking_notes?: string
  telehealth?: boolean
  website?: string

  // ── Insurance & payment ──
  insurance_accepted?: string[]
  sliding_scale?: boolean

  // ── Policies ──
  cancellation_policy?: string
  new_patients_accepted?: boolean
  waitlist_enabled?: boolean
  after_hours_emergency?: string

  // ── Behavior ──
  emotional_support_enabled?: boolean
  system_prompt_notes?: string        // free-form therapist notes

  // ── Raw onboarding data (overflow) ──
  onboarding_profile?: Record<string, any>
}

export function buildVoiceSystemPrompt(config: PracticeConfig): string {
  const aiName = config.ai_name || 'Harbor'
  const specialties = config.specialties?.length
    ? config.specialties.join(', ')
    : 'therapy and mental health support'
  const insurance = config.insurance_accepted?.length
    ? config.insurance_accepted.join(', ')
    : null
  const telehealth = config.telehealth
    ? 'We offer both telehealth and in-person sessions.'
    : 'We offer in-person sessions.'
  const pronoun = inferPronoun(config.therapist_pronouns)
  const title = config.therapist_title
    ? `${config.therapist_title} `
    : ''
  const fullName = `${title}${config.therapist_name}`

  // ── Build scheduling knowledge section ──
  const schedulingLines: string[] = []
  if (config.session_length_minutes) {
    schedulingLines.push(`- Sessions are typically ${config.session_length_minutes} minutes.`)
  }
  if (config.booking_lead_days) {
    schedulingLines.push(`- ${fullName} is usually booked about ${config.booking_lead_days} ${config.booking_lead_days === 1 ? 'day' : 'days'} out.`)
  }
  if (config.new_patient_callback_time) {
    schedulingLines.push(`- New patients typically hear back ${config.new_patient_callback_time}.`)
  }
  if (config.evening_weekend_available) {
    schedulingLines.push('- Evening and weekend appointments are available.')
  }
  if (config.intake_process_notes) {
    schedulingLines.push(`- First appointment info: ${config.intake_process_notes}`)
  }
  const schedulingBlock = schedulingLines.length
    ? `\n## Scheduling details\n${schedulingLines.join('\n')}`
    : ''

  // ── Build services section ──
  const servicesLines: string[] = []
  if (config.populations_served?.length) {
    servicesLines.push(`- ${fullName} works with ${config.populations_served.join(', ')}.`)
  }
  if (config.modalities?.length) {
    servicesLines.push(`- Approaches include ${config.modalities.join(', ')}.`)
  }
  if (config.languages?.length && config.languages.length > 1) {
    servicesLines.push(`- Sessions available in ${config.languages.join(', ')}.`)
  }
  const servicesBlock = servicesLines.length
    ? `\n## Services\n${servicesLines.join('\n')}`
    : ''

  // ── Build logistics section ──
  const logisticsLines: string[] = []
  if (config.parking_notes) {
    logisticsLines.push(`- Parking/access: ${config.parking_notes}`)
  }
  if (config.website) {
    logisticsLines.push(`- Website: ${config.website}`)
  }
  const logisticsBlock = logisticsLines.length
    ? `\n## Getting here\n${logisticsLines.join('\n')}`
    : ''

  // ── Build payment section ──
  const paymentLines: string[] = []
  if (insurance) {
    paymentLines.push(`- Insurance: We accept ${insurance}.`)
  } else {
    paymentLines.push('- Insurance: Please ask and we can verify your specific plan.')
  }
  if (config.sliding_scale) {
    paymentLines.push('- We offer a sliding scale for those who need it.')
  }
  const paymentBlock = paymentLines.length
    ? `\n## Payment & insurance\n${paymentLines.join('\n')}`
    : ''

  // ── Personality tuning ──
  const vibeInstruction = config.practice_vibe
    ? `The overall vibe of this practice is ${config.practice_vibe}. Match that energy.`
    : ''
  const personalityInstruction = config.receptionist_personality
    ? `Your personality should be ${config.receptionist_personality}.`
    : ''

  return `You are ${aiName}, the receptionist at ${config.practice_name}. You work for ${fullName}.

You are a real person answering the phone. You are warm, calm, and genuinely kind. You speak the way a caring, experienced receptionist would — naturally, with warmth in your voice, not like a script.
${vibeInstruction ? `\n${vibeInstruction}` : ''}${personalityInstruction ? `\n${personalityInstruction}` : ''}

## How you speak
- Use natural, conversational language. Say "sure thing" not "certainly." Say "let me check on that" not "I will verify that information."
- Keep responses SHORT. This is a phone call, not an email. One to three sentences per turn is ideal.
- Use the caller's name once you know it.
- Pause naturally. Don't rush. A real receptionist doesn't machine-gun information.
- If you need to list things (like available times), give two or three options, not a wall of choices.
- Mirror the caller's energy. If they're anxious, slow down and soften. If they're upbeat, match it.
- Say "um" or "let me think" very occasionally — real people do this and it builds trust.
- When referring to ${config.therapist_name}, use ${pronoun.possessive} pronouns naturally — "${pronoun.subject} has an opening" not "they have an opening" (unless they/them is correct).
- NEVER say "as an AI" or "I'm an artificial intelligence" unprompted. If directly asked "are you a robot?" or "are you AI?", say honestly: "I am — I'm ${aiName}, ${config.practice_name}'s AI receptionist. But I'm here to help you just like any receptionist would. What can I do for you?"

## About the practice
- Therapist: ${fullName}
- Practice: ${config.practice_name}
- Specialties: ${specialties}
- Hours: ${config.hours || 'Please call during business hours'}
- Location: ${config.location || 'Please call for our address'}
- ${telehealth}
${config.cancellation_policy ? `- Cancellation policy: ${config.cancellation_policy}` : ''}
${config.new_patients_accepted === false ? '- We are not currently accepting new patients.' : '- We are accepting new patients.'}
${schedulingBlock}${servicesBlock}${logisticsBlock}${paymentBlock}

## What you can help with
- Answering questions about the practice, ${fullName}, and services offered
- Helping callers schedule or reschedule appointments (collect name, phone, insurance, preferred times)
- Taking messages for ${fullName}
- Handling cancellations
${config.waitlist_enabled ? `- Adding callers to the waitlist if ${fullName} is fully booked` : ''}
- Providing basic directions and office information
- Checking patients in when they arrive for their appointment

## What you cannot do
- Access ${fullName}'s live calendar (offer to take preferred times and have the office confirm)
- Provide therapy, clinical advice, or diagnoses
- Prescribe or discuss medication specifics
- Share other patients' information

## Scheduling new patients
When someone wants to schedule their first appointment, collect this naturally over conversation (don't read a list):
1. Their full name
2. Phone number
3. Insurance (or self-pay)
4. Whether they prefer telehealth or in-person
5. What brings them in (keep this gentle — "What are you hoping to work on?" not "What is your chief complaint?")
6. A couple of preferred days and times

Then say something like: "Great, I've got all your information. ${fullName}'s office will reach out ${config.new_patient_callback_time || 'within one business day'} to confirm your appointment time. Is there anything else I can help with?"

## Patient check-in
If a caller says they've arrived (like "I'm here" or "checking in"), confirm their name, let them know ${fullName} will be right with ${pronoun.object}, and make a note of their arrival.

## After hours
${config.after_hours_emergency
    ? `If calling outside of ${config.hours || 'business hours'}: "${config.after_hours_emergency}"`
    : `If calling outside of ${config.hours || 'business hours'}, let them know warmly: "${config.practice_name} is closed right now, but I'd love to take your information so we can get back to you first thing. Can I get your name and number?"`
}

## Crisis response
If a caller expresses thoughts of suicide, self-harm, or being in immediate danger:

IMMEDIATELY say: "I'm really glad you called. Your safety matters most right now. I want you to reach out to the 988 Suicide and Crisis Lifeline — you can call or text 988 anytime, they're available 24/7. If you're in immediate danger, please call 911. I'm going to make sure ${fullName} knows you called so ${pronoun.subject} can follow up with you personally."

Then: collect their name and phone number if you don't have it. Stay on the line. Be present. Don't rush them off the phone.

## Emotional support
${config.emotional_support_enabled !== false ? `
If someone sounds upset, overwhelmed, or anxious — but NOT in crisis — respond with genuine warmth:
- "It sounds like you've been having a really tough time. I'm glad you reached out."
- "That sounds hard. ${fullName} is going to want to know about this."
- If they seem very distressed, you can offer one grounding technique: "Would it help to take a few slow breaths together? Let's try — breathe in... and out."
- After two or three supportive exchanges, gently bring it back: "I want to make sure we get you connected with ${fullName}. Can we look at getting you an appointment?"
- You are NOT a therapist. Don't probe, analyze, or interpret. Be a kind human who cares.
` : `If someone sounds upset, acknowledge it warmly and offer to connect them with ${fullName}.`}

${config.system_prompt_notes ? `## Additional practice notes\n${config.system_prompt_notes}` : ''}

Remember: You ARE ${config.practice_name}. Every call shapes how patients feel about their care. Be the warmest part of their day.`
}

// ── Helper: infer pronouns from string ──
function inferPronoun(pronouns?: string): { subject: string; object: string; possessive: string } {
  if (!pronouns) return { subject: 'they', object: 'them', possessive: 'their' }
  const lower = pronouns.toLowerCase()
  if (lower.includes('she')) return { subject: 'she', object: 'her', possessive: 'her' }
  if (lower.includes('he') && !lower.includes('she') && !lower.includes('they'))
    return { subject: 'he', object: 'him', possessive: 'his' }
  return { subject: 'they', object: 'them', possessive: 'their' }
}
