// lib/aws/provisioning/signalwire-numbers.ts
//
// Wave 29 — SignalWire phone number provisioning. Search availability +
// purchase + configure inbound webhooks. Pure functions, no DB writes;
// the orchestrator persists IDs.

const PROJECT_ID = process.env.SIGNALWIRE_PROJECT_ID || ''
const TOKEN = process.env.SIGNALWIRE_TOKEN || ''
const SPACE_URL = process.env.SIGNALWIRE_SPACE_URL || ''
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://lab.harboroffice.ai'

function authHeader(): string {
  return `Basic ${Buffer.from(`${PROJECT_ID}:${TOKEN}`).toString('base64')}`
}

function laMLBase(): string {
  return `https://${SPACE_URL}/api/laml/2010-04-01/Accounts/${PROJECT_ID}`
}

export interface AvailableNumber {
  phoneNumber: string  // E.164
  friendlyName: string
  region: string
  locality: string
  isoCountry: string
  capabilities: { voice?: boolean; sms?: boolean; mms?: boolean }
}

/**
 * Search SignalWire's pool for available US local numbers.
 * If areaCode given, scopes to that NPA.
 */
export async function searchAvailableNumbers(opts: {
  areaCode?: string
  limit?: number
}): Promise<AvailableNumber[]> {
  if (!PROJECT_ID || !TOKEN || !SPACE_URL) throw new Error('SIGNALWIRE_NOT_CONFIGURED')
  const limit = opts.limit ?? 5
  const params = new URLSearchParams({ PageSize: String(limit) })
  if (opts.areaCode) params.set('AreaCode', opts.areaCode)
  const url = `${laMLBase()}/AvailablePhoneNumbers/US/Local.json?${params.toString()}`
  const res = await fetch(url, { headers: { Authorization: authHeader() } })
  if (!res.ok) throw new Error(`signalwire_search_failed_${res.status}: ${await res.text().catch(() => '')}`)
  const json = await res.json() as any
  const items: any[] = json.available_phone_numbers ?? []
  return items.map(n => ({
    phoneNumber: n.phone_number,
    friendlyName: n.friendly_name,
    region: n.region,
    locality: n.locality,
    isoCountry: n.iso_country,
    capabilities: n.capabilities ?? {},
  }))
}

export interface PurchasedNumber {
  sid: string
  phoneNumber: string
  voiceUrl: string
  smsUrl: string
}

/**
 * Purchase a specific number and configure its webhooks to point at
 * our app's inbound voice + SMS endpoints.
 */
export async function purchaseAndConfigureNumber(opts: {
  phoneNumber: string  // E.164 from searchAvailableNumbers
  friendlyName?: string
}): Promise<PurchasedNumber> {
  if (!PROJECT_ID || !TOKEN || !SPACE_URL) throw new Error('SIGNALWIRE_NOT_CONFIGURED')
  const body = new URLSearchParams({
    PhoneNumber: opts.phoneNumber,
    FriendlyName: opts.friendlyName || `Harbor ${opts.phoneNumber}`,
    VoiceUrl: `${APP_URL}/api/signalwire/inbound-voice`,
    VoiceMethod: 'POST',
    SmsUrl: `${APP_URL}/api/signalwire/inbound-sms`,
    SmsMethod: 'POST',
    StatusCallback: `${APP_URL}/api/signalwire/sms-status`,
    StatusCallbackMethod: 'POST',
  })
  const res = await fetch(`${laMLBase()}/IncomingPhoneNumbers.json`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`signalwire_purchase_failed_${res.status}: ${await res.text().catch(() => '')}`)
  const json = await res.json() as any
  return {
    sid: json.sid,
    phoneNumber: json.phone_number,
    voiceUrl: json.voice_url,
    smsUrl: json.sms_url,
  }
}

/**
 * Update an existing number's webhooks (used for re-pointing during
 * migrations or when the practice's app URL changes).
 */
export async function updateNumberWebhooks(opts: {
  sid: string
  voiceUrl?: string
  smsUrl?: string
}): Promise<void> {
  if (!PROJECT_ID || !TOKEN || !SPACE_URL) throw new Error('SIGNALWIRE_NOT_CONFIGURED')
  const body = new URLSearchParams()
  if (opts.voiceUrl) {
    body.set('VoiceUrl', opts.voiceUrl)
    body.set('VoiceMethod', 'POST')
  }
  if (opts.smsUrl) {
    body.set('SmsUrl', opts.smsUrl)
    body.set('SmsMethod', 'POST')
  }
  const res = await fetch(`${laMLBase()}/IncomingPhoneNumbers/${opts.sid}.json`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`signalwire_update_failed_${res.status}`)
}
