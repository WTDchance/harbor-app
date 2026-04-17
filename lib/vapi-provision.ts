// Vapi provisioning helpers used during new-practice signup.
// Handles: creating a per-practice assistant, registering a Twilio number
// with Vapi, and tearing them back down on failure.

const VAPI_API_KEY = process.env.VAPI_API_KEY || ''
const VAPI_WEBHOOK_SECRET = process.env.VAPI_WEBHOOK_SECRET || ''
const VAPI_BASE_URL = 'https://api.vapi.ai'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'

// 11labs "Bella" - warm female voice, Harbor default.h
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'

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
        stability: 0.5,
        similarityBoost: 0.75,
      },
      firstMessage: p.greeting,
      endCallMessage: `Thank you for calling ${p.name}. Have a wonderful day!`,
      silenceTimeoutSeconds: 30,
      maxDurationSeconds: 600,
      backgroundSound: 'office',
      backchannelingEnabled: true,
      // hipaaEnabled requires Vapi's $1k/mo HIPAA plan + BAA.
      // Enable once the plan is active — do NOT set without it.
      // hipaaEnabled: true,
      transcriber: { provider: 'deepgram', model: 'nova-2', language: 'en-US' },
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

  const res = await fetch(`${VAPI_BASE_URL}/phone-number`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider: 'twilio',
      number: opts.twilioPhoneNumber,
      twilioAccountSid: accountSid,
      twilioAuthToken: authToken,
      assistantId: opts.assistantId,
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
          body: JSON.stringify({ assistantId: opts.assistantId }),
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
