// Vapi provisioning helpers used during new-practice signup.
// Handles: creating a per-practice assistant, registering a Twilio number
// with Vapi, and tearing them back down on failure.

const VAPI_API_KEY = process.env.VAPI_API_KEY || ''
const VAPI_WEBHOOK_SECRET = process.env.VAPI_WEBHOOK_SECRET || ''
const VAPI_BASE_URL = 'https://api.vapi.ai'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'

// 11labs "Bella" - warm female voice, Harbor default.h
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'

// Post-call summary prompt. Produces structured, scannable summaries instead
// of the default Vapi run-on paragraph. Kept in plain text (no markdown bold)
// so it renders cleanly in the dashboard via `whitespace-pre-wrap`. Shared
// across all sync paths — vapi-provision, repair-practice, practices/[id] —
// so every assistant writes summaries in the same shape.
export const HARBOR_SUMMARY_PROMPT = [
  'Summarize the call in these five sections, each on its own line with a blank line between sections. Use these exact headers in ALL CAPS followed by a colon. Do NOT use markdown, bullets beyond a simple hyphen, or any other formatting.',
  '',
  'CALLER: Caller name, phone number if given, and whether they are a new or existing patient.',
  '',
  'REASON: One or two sentences on why they called.',
  '',
  'OUTCOME: What was accomplished on this call — appointment booked (with date/time), message taken, question answered, cancellation processed, transferred to therapist, etc.',
  '',
  'ACTION ITEMS: What the therapist needs to do next. One item per line prefixed with "- ". Write "None" if no follow-up is needed.',
  '',
  'NOTES: Anything else that matters — patient preferences, insurance details mentioned, emotional state, crisis indicators, or context the therapist should know. Keep it brief. Write "None" if nothing to add.',
  '',
  'Keep each section concise and operational. Do not include medical details beyond what is necessary for the therapist to follow up.',
].join('\n')

export interface PracticeContext {
  id: string
  name: string
  providerName: string
  aiName: string
  greeting: string
  specialties?: string[]
  insuranceAccepted?: string[]
  location?: string | null
  telehealth?: boolean
  timezone?: string
}

function buildSystemPrompt(p: PracticeContext): string {
  const specialties =
    p.specialties && p.specialties.length > 0
      ? p.specialties.join(', ')
      : 'general therapy'
  const insurance =
    p.insuranceAccepted && p.insuranceAccepted.length > 0
      ? p.insuranceAccepted.join(', ')
      : 'various insurance plans'
  const telehealth = p.telehealth
    ? 'Yes, telehealth appointments are available.'
    : 'No, only in-person appointments.'

  return (
    `You are ${p.aiName}, the AI receptionist for ${p.name}. ` +
    `${p.providerName} is the therapist. ` +
    `The practice is located in ${p.location || 'the local area'} and specializes in ${specialties}. ` +
    `Insurance accepted: ${insurance}. Telehealth: ${telehealth}. ` +
    `Your role is to answer calls, help patients schedule appointments, collect basic information, ` +
    `and transfer to the provider when needed. Be warm, professional, and HIPAA-conscious. ` +
    `Never discuss specific patient medical details. ` +
    `If a caller expresses suicidal thoughts, self-harm, or other crisis signals, provide the ` +
    `988 Suicide & Crisis Lifeline immediately and keep them engaged until help is available.`
  )
}

/**
 * Create a Vapi assistant for a new practice, wired up to the Harbor webhook
 * so post-call reports land in /api/vapi/webhook with the correct practice_id.
 */
export async function createVapiAssistant(p: PracticeContext): Promise<string> {
  if (!VAPI_API_KEY) throw new Error('VAPI_API_KEY not configured')

  const serverUrl = VAPI_WEBHOOK_SECRET
    ? `${APP_URL}/api/vapi/webhook?secret=${encodeURIComponent(VAPI_WEBHOOK_SECRET)}`
    : `${APP_URL}/api/vapi/webhook`

  const res = await fetch(`${VAPI_BASE_URL}/assistant`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: `${p.aiName} - ${p.name}`,
      model: {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'system', content: buildSystemPrompt(p) }],
        temperature: 0.7,
      },
      voice: {
        provider: '11labs',
        voiceId: DEFAULT_VOICE_ID,
        model: 'eleven_turbo_v2_5',
        // Keep these aligned with the PATCH-time defaults in
        // /api/admin/repair-practice so freshly provisioned practices behave
        // identically to re-synced ones.
        stability: 0.6,
        similarityBoost: 0.75,
        speed: 0.9,
        style: 0.05,
        useSpeakerBoost: true,
      },
      firstMessage: p.greeting,
      endCallMessage: `Thank you for calling ${p.name}. Have a wonderful day!`,
      // Ellie must be able to end the call herself. Without this she can only
      // say goodbye verbally while the call continues until maxDuration.
      endCallFunctionEnabled: true,
      silenceTimeoutSeconds: 30,
      maxDurationSeconds: 900,
      backgroundSound: 'office',
      backchannelingEnabled: true,
      // hipaaEnabled requires Vapi's $1k/mo HIPAA plan + BAA.
      // Enable once the plan is active — do NOT set without it.
      // hipaaEnabled: true,
      transcriber: { provider: 'deepgram', model: 'nova-2', language: 'en-US' },
      // Structured post-call summary so dashboard + email notifications
      // show scannable sections instead of a run-on paragraph.
      analysisPlan: {
        summaryPrompt: HARBOR_SUMMARY_PROMPT,
      },
      server: { url: serverUrl },
      metadata: {
        practiceId: p.id,
        practiceName: p.name,
        providerName: p.providerName,
      },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Vapi assistant creation failed: ${res.status} ${err}`)
  }

  const data = await res.json()
  if (!data.id) throw new Error('Vapi assistant response missing id')
  return data.id as string
}

/**
 * Register a Twilio number with Vapi so inbound calls route to the given
 * assistant. Returns the Vapi phone-number record id.
 */
export async function linkVapiPhoneNumber(opts: {
  assistantId: string
  twilioPhoneNumber: string
  practiceName: string
}): Promise<string> {
  if (!VAPI_API_KEY) throw new Error('VAPI_API_KEY not configured')
  const accountSid = process.env.TWILIO_ACCOUNT_SID || ''
  const authToken = process.env.TWILIO_AUTH_TOKEN || ''

  // Include the webhook secret on the phone-level serverUrl so Vapi
  // can reach our webhook regardless of whether it uses the phone's
  // or the assistant's server config for post-call events.
  const serverUrl = VAPI_WEBHOOK_SECRET
    ? `${APP_URL}/api/vapi/webhook?secret=${encodeURIComponent(VAPI_WEBHOOK_SECRET)}`
    : `${APP_URL}/api/vapi/webhook`

  const res = await fetch(`${VAPI_BASE_URL}/phone-number`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    // NOTE: We intentionally omit assistantId on the phone config.
    // When assistantId is set, Vapi uses the static assistant and NEVER
    // fires assistant-request to our webhook. By omitting it, every inbound
    // call triggers assistant-request → handleAssistantRequest builds a
    // dynamic, practice-specific assistant config with the latest system
    // prompt and voice settings. The serverUrl is all Vapi needs.
    body: JSON.stringify({
      provider: 'twilio',
      number: opts.twilioPhoneNumber,
      twilioAccountSid: accountSid,
      twilioAuthToken: authToken,
      serverUrl: serverUrl,
      name: `${opts.practiceName}`.substring(0, 40),
    }),
  })

  if (!res.ok) {
    const errText = await res.text()

    // Vapi 400 when the Twilio number is already registered with Vapi:
    //   "Existing Phone Number <uuid> Has Identical `twilioAccountSid` ... and `number` ..."
    // In that case, PATCH the existing record to point at our new assistant
    // instead of failing — this lets us re-attach Vapi to a practice whose
    // number was previously provisioned (e.g. the Harbor demo line).
    if (res.status === 400) {
      const m = errText.match(/Existing Phone Number ([0-9a-f-]{36})/i)
      if (m) {
        const existingId = m[1]
        const patch = await fetch(`${VAPI_BASE_URL}/phone-number/${existingId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${VAPI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ assistantId: null, serverUrl }),
        })
        if (!patch.ok) {
          const pErr = await patch.text()
          throw new Error(
            `Vapi phone-number relink failed: ${patch.status} ${pErr}`
          )
        }
        return existingId
      }
    }

    throw new Error(`Vapi phone-number link failed: ${res.status} ${errText}`)
  }

  const data = await res.json()
  if (!data.id) throw new Error('Vapi phone-number response missing id')
  return data.id as string
}

/**
 * Best-effort cleanup of a Vapi assistant - used when later steps in the
 * provisioning pipeline fail and we want to roll back.
 */
export async function deleteVapiAssistant(assistantId: string): Promise<void> {
  if (!VAPI_API_KEY) return
  try {
    await fetch(`${VAPI_BASE_URL}/assistant/${assistantId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
    })
  } catch (e) {
    console.error(`Failed to delete Vapi assistant ${assistantId}:`, e)
  }
}
