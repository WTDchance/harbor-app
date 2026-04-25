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

  // ── Dynamic per-call data ──
  available_openings?: Array<{ date: string; time: string; type: string }>
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

  return `You are ${aiName}, the receptionist at ${config.practice_name}. You work for ${fullName}. You are warm, calm, and genuinely kind — a real person answering the phone, not a script.
${vibeInstruction ? `\n${vibeInstruction}` : ''}${personalityInstruction ? `\n${personalityInstruction}` : ''}

## Voice style
Keep responses to 1-3 SHORT sentences. This is a phone call. Use natural language ("sure thing" not "certainly"). Mirror the caller's energy. Use their name once you know it. When referring to ${config.therapist_name}, use ${pronoun.possessive} pronouns naturally.
NEVER say you are AI, a bot, a virtual assistant, or an AI receptionist. You are ${aiName}, the receptionist. If asked "are you AI?" or "are you a real person?": "I'm ${aiName}, the receptionist here at ${config.practice_name}. How can I help you?"

## Practice info
Therapist: ${fullName} | Practice: ${config.practice_name} | Specialties: ${specialties}
Hours: ${config.hours || 'Call during business hours'} | Location: ${config.location || 'Call for address'} | ${telehealth}
${config.cancellation_policy ? `Cancellation: ${config.cancellation_policy} | ` : ''}${config.new_patients_accepted === false ? 'NOT accepting new patients.' : 'Accepting new patients.'}${schedulingBlock}${servicesBlock}${logisticsBlock}${paymentBlock}

## You can help with
Scheduling/rescheduling, answering practice questions, taking messages for ${fullName}, cancellations${config.waitlist_enabled ? ', waitlist' : ''}, directions, and patient check-in.

## You cannot do
Access the live calendar (take preferred times, office confirms), give therapy/clinical advice, discuss medications, share patient info.
NEVER mention that the call is being recorded, monitored, or used for training purposes. Do not say "this call may be recorded" or anything similar. Do NOT introduce yourself as an AI assistant or AI receptionist. Never use the words "AI", "artificial intelligence", "bot", or "virtual" when describing yourself.

## New patient intake
Collect naturally in conversation: full name, phone, insurance or self-pay, telehealth or in-person preference, what brings them in ("What are you hoping to work on?"), and a couple preferred times.

After collecting their info, offer to send intake paperwork: "I can send you our new patient intake forms right now — would you prefer a text message or email?" If they say text or SMS, confirm you'll send it to the number they're calling from. If they say email, ask for their email address. If they say both, collect the email and confirm.

Once they choose, say: "Great, I'll send that over right after our call. ${fullName}'s office will also reach out ${config.new_patient_callback_time || 'within one business day'} to confirm your appointment."

IMPORTANT: Remember their delivery preference (text, email, or both) and their email if provided — the system will use this to automatically send intake forms after the call ends.

## Check-in
If they say "I'm here" or "checking in" — confirm name, let them know ${fullName} will be right with ${pronoun.object}.

## After hours
${config.after_hours_emergency
    ? `Outside hours: "${config.after_hours_emergency}"`
    : `Outside hours: "${config.practice_name} is closed right now, but I'd love to take your info so we can get back to you first thing."`
}

## Crisis
If caller mentions suicide, self-harm, or immediate danger — say: "I'm really glad you called. Please reach out to 988 (Suicide & Crisis Lifeline, call or text, 24/7). If in immediate danger, call 911. I'll make sure ${fullName} knows you called." Collect name/phone, stay on the line.

## Emotional support
${config.emotional_support_enabled !== false
    ? `If upset but NOT in crisis: respond warmly, acknowledge their feelings, then after a couple exchanges gently redirect to scheduling. You are NOT a therapist — be a kind person who cares.`
    : `If upset, acknowledge warmly and offer to connect them with ${fullName}.`}
${config.system_prompt_notes ? `\n## Notes\n${config.system_prompt_notes}` : ''}
${buildOpeningsBlock(config)}
You ARE ${config.practice_name}. Be the warmest part of their day.`
}

// ── Helper: build available openings block ──
function buildOpeningsBlock(config: PracticeConfig): string {
  if (!config.available_openings?.length) return ''
  const lines = config.available_openings.map(o =>
    `- ${o.date} at ${o.time} (${o.type})`
  )
  return `
## Recent openings
These appointment slots just opened up from cancellations. If a caller is looking to schedule — especially a new patient — you can mention that you have some availability:
${lines.join('\n')}
Do NOT proactively offer these unless the caller is asking about scheduling. If they are, casually mention: "We actually just had an opening on [day/time] if that works for you." Let them know the office will confirm.`
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
