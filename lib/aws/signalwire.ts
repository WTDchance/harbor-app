// lib/aws/signalwire.ts
//
// Wave 27d — SignalWire wrapper. Replaces lib/twilio for the AWS
// stack. SignalWire's LaML is Twilio-API-compatible (basic auth =
// project_id:token, REST endpoint shape mirrors twilio.com/2010-04-01),
// so the surface here is intentionally narrow: sendSMS, signature
// validation for inbound webhooks, and a TwiML helper for routing
// inbound voice into Retell's media stream.
//
// Env vars (Wave 27b SSM-backed):
//   SIGNALWIRE_PROJECT_ID
//   SIGNALWIRE_TOKEN
//   SIGNALWIRE_SPACE_URL          (host only, e.g. harborreceptionist-com.signalwire.com)
//   SIGNALWIRE_FROM_NUMBER        (E.164)
//
// Optional:
//   SIGNALWIRE_VALIDATE_INBOUND   (default 'true' — flip to 'false' in
//                                  staging if signature verification
//                                  blocks a critical test path)

import { createHmac } from 'node:crypto'
import { pool } from '@/lib/aws/db'

const PROJECT_ID = process.env.SIGNALWIRE_PROJECT_ID || ''
const TOKEN = process.env.SIGNALWIRE_TOKEN || ''

// Wave 27p — LaML signature signing key. SignalWire's webhook signature uses
// the LaML "Signing Key" (PSK_…), which is DIFFERENT from the project token
// (PT_…) used for REST basic-auth. Falls back to TOKEN for backward compat
// (and so the dev container that only sets SIGNALWIRE_TOKEN keeps working).
function signingKey(): string {
  return process.env.SIGNALWIRE_SIGNING_KEY || process.env.SIGNALWIRE_TOKEN || ''
}
const SPACE_URL = process.env.SIGNALWIRE_SPACE_URL || ''
const FROM_NUMBER = process.env.SIGNALWIRE_FROM_NUMBER || ''

function basicAuthHeader(): string {
  return 'Basic ' + Buffer.from(`${PROJECT_ID}:${TOKEN}`).toString('base64')
}

function laMLEndpoint(): string {
  // SignalWire LaML is Twilio-compat; path mirrors twilio's 2010-04-01.
  return `https://${SPACE_URL}/api/laml/2010-04-01/Accounts/${PROJECT_ID}/Messages.json`
}

export type SmsResult =
  | { ok: true; sid: string }
  | { ok: false; reason: string; status?: number }

/**
 * Internal opt-out check against the practice's sms_opt_outs table.
 * Mirrors the Wave-23 communication-prefs route's read.
 */
async function isOptedOut(practiceId: string | null, toNumber: string): Promise<boolean> {
  try {
    const params: any[] = [toNumber]
    let where = `phone = $1`
    if (practiceId) {
      params.push(practiceId)
      where += ` AND practice_id = $${params.length}`
    }
    const { rowCount } = await pool.query(
      `SELECT 1 FROM sms_opt_outs WHERE ${where} LIMIT 1`,
      params,
    )
    return (rowCount ?? 0) > 0
  } catch {
    return false
  }
}

/**
 * Send an SMS via SignalWire's LaML endpoint. Skips silently if the
 * recipient is on the practice's sms_opt_outs list.
 */
export async function sendSMS(args: {
  to: string
  body: string
  from?: string
  practiceId?: string | null
  statusCallback?: string
}): Promise<SmsResult> {
  if (!PROJECT_ID || !TOKEN || !SPACE_URL) {
    return { ok: false, reason: 'signalwire_not_configured' }
  }
  const fromNumber = args.from || FROM_NUMBER
  if (!fromNumber) {
    return { ok: false, reason: 'no_from_number' }
  }
  if (await isOptedOut(args.practiceId ?? null, args.to)) {
    return { ok: false, reason: 'recipient_opted_out' }
  }

  const params = new URLSearchParams()
  params.set('From', fromNumber)
  params.set('To', args.to)
  params.set('Body', args.body)
  if (args.statusCallback) params.set('StatusCallback', args.statusCallback)

  try {
    const res = await fetch(laMLEndpoint(), {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[signalwire/send]', res.status, text.slice(0, 200))
      return { ok: false, reason: 'signalwire_api_error', status: res.status }
    }
    const json: any = await res.json()
    return { ok: true, sid: json?.sid ?? '' }
  } catch (err) {
    console.error('[signalwire/send] fetch failed:', (err as Error).message)
    return { ok: false, reason: 'fetch_error' }
  }
}

/**
 * Reconstruct the externally-visible URL from a Next request behind
 * ALB+ECS. SignalWire signs based on the URL it POSTed to (e.g.
 * https://lab.harboroffice.ai/api/signalwire/inbound-voice), but
 * inside the Fargate container req.url reports the internal bind
 * address (http://...:3000/...). Without reconstruction every
 * signed request fails verification.
 */
export function publicWebhookUrl(req: {
  url: string
  headers: { get(name: string): string | null }
}): string {
  const u = new URL(req.url)
  const proto = req.headers.get('x-forwarded-proto') || u.protocol.replace(':', '')
  // x-forwarded-host preferred (set by ALB); fall back to Host header.
  const host = req.headers.get('x-forwarded-host')
    || req.headers.get('host')
    || u.host
  return `${proto}://${host}${u.pathname}${u.search}`
}

/**
 * Twilio/SignalWire LaML signature: HMAC-SHA1 over the absolute URL
 * concatenated with the sorted form-data key/value pairs, base64.
 * SignalWire's docs explicitly mirror the Twilio algorithm.
 *
 * URL must be the externally-visible URL — see publicWebhookUrl().
 */
/**
 * Build the buffer that gets HMAC'd and the resulting base64 HMAC, using
 * the Twilio/SignalWire LaML signature algorithm. Exported so debug
 * logging in the route can show exactly what we'd compare against.
 */
export function computeWebhookSignature(args: {
  rawUrl: string
  formParams: Record<string, string>
}): { buf: string; hmac: string } {
  const sortedKeys = Object.keys(args.formParams).sort()
  let buf = args.rawUrl
  for (const k of sortedKeys) {
    buf += k + (args.formParams[k] ?? '')
  }
  const hmac = createHmac('sha1', signingKey()).update(buf).digest('base64')
  return { buf, hmac }
}

export function validateInboundWebhook(args: {
  rawUrl: string
  formParams: Record<string, string>
  signatureHeader: string | null | undefined
}): boolean {
  if (!signingKey()) return false
  if (!args.signatureHeader) return false
  if (process.env.SIGNALWIRE_VALIDATE_INBOUND === 'false') return true

  const { hmac } = computeWebhookSignature({
    rawUrl: args.rawUrl,
    formParams: args.formParams,
  })
  return hmac === args.signatureHeader
}

/**
 * Build a LaML/TwiML response that bridges the inbound call into Retell's
 * per-call audio websocket. Retell expects the wss URL to embed the call_id
 * returned by /v2/register-phone-call so the websocket can authenticate +
 * pick up the dynamic_variables that were registered with the call.
 *
 * The legacy wss://api.retellai.com/v2/agent/<agent_id>/audio endpoint is
 * deprecated; SignalWire's media gateway accepts the upgrade briefly but
 * Retell tears it down because no per-call context is attached.
 *
 * Pattern: wss://api.retellai.com/audio-websocket/<call_id>
 */
export function laMLConnectToRetell(args: {
  callId: string
  callMetadata?: Record<string, string>
}): string {
  const streamUrl = `wss://api.retellai.com/audio-websocket/${args.callId}`
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      ${Object.entries(args.callMetadata ?? {})
        .map(([k, v]) => `<Parameter name="${k}" value="${v}" />`)
        .join('\n      ')}
    </Stream>
  </Connect>
</Response>`
}

/**
 * Helper for downstream routes that need to know whether SignalWire
 * is configured. Used to surface a clear 503 when secrets are
 * missing instead of failing inside the fetch.
 */
export function signalwireConfigured(): boolean {
  return !!(PROJECT_ID && TOKEN && SPACE_URL && FROM_NUMBER)
}

// ───────────────────────────────────────────────────────────────────────────
// Wave 41 — Twilio-shape parity helpers.
//
// Added during the Twilio→SignalWire port so the legacy `lib/twilio.ts`
// callers (crisis SMS, reminders, no-show / prep, sms-inbound, the vapi
// webhook's outbound notify, lib/reminders) can swap imports with minimal
// edits and the route bodies keep their existing shape. Helpers below
// hit SignalWire's LaML REST API (Twilio-API-compat) using basic auth
// against PROJECT_ID:TOKEN — the same pattern as sendSMS above.
// ───────────────────────────────────────────────────────────────────────────

function laMLAccountBase(): string {
  return `https://${SPACE_URL}/api/laml/2010-04-01/Accounts/${PROJECT_ID}`
}

/**
 * Wave 41 — outbound SMS from a specific SignalWire number (multi-number
 * setups). Mirrors the legacy lib/twilio.ts::sendSMSFromNumber shape but
 * uses the SignalWire LaML endpoint.
 *
 * The `from` parameter must already be E.164 and owned by the SignalWire
 * project; otherwise SignalWire returns 21606 ("'From' phone number is
 * not a valid, SMS-capable inbound phone number").
 */
export async function sendSMSFromNumber(args: {
  from: string
  to: string
  body: string
  practiceId?: string | null
  statusCallback?: string
}): Promise<SmsResult> {
  return sendSMS({
    to: args.to,
    body: args.body,
    from: args.from,
    practiceId: args.practiceId ?? null,
    statusCallback: args.statusCallback,
  })
}

/**
 * Wave 41 — list every IncomingPhoneNumber owned by this SignalWire
 * project. Used by /api/admin/phone-diag and /api/admin/reprovision to
 * answer "which practice owns this inbound number?".
 */
export async function listPhoneNumbers(): Promise<Array<{
  sid: string
  phoneNumber: string
  friendlyName: string
  smsUrl: string
  voiceUrl: string
}>> {
  if (!PROJECT_ID || !TOKEN || !SPACE_URL) return []
  try {
    const url = `${laMLAccountBase()}/IncomingPhoneNumbers.json?PageSize=200`
    const res = await fetch(url, { headers: { Authorization: basicAuthHeader() } })
    if (!res.ok) {
      console.error('[signalwire/list] http', res.status, (await res.text().catch(() => '')).slice(0, 200))
      return []
    }
    const json: any = await res.json()
    const items: any[] = json.incoming_phone_numbers ?? []
    return items.map(n => ({
      sid: n.sid,
      phoneNumber: n.phone_number,
      friendlyName: n.friendly_name,
      smsUrl: n.sms_url,
      voiceUrl: n.voice_url,
    }))
  } catch (err) {
    console.error('[signalwire/list] threw:', (err as Error).message)
    return []
  }
}

/**
 * Wave 41 — fetch a single IncomingPhoneNumber's SMS webhook config.
 * Used by reprovision to verify the inbound URL points at this app.
 */
export async function getPhoneNumberWebhook(phoneNumberSid: string): Promise<{
  phoneNumber: string
  smsUrl: string
  smsMethod: string
} | null> {
  if (!PROJECT_ID || !TOKEN || !SPACE_URL) return null
  try {
    const url = `${laMLAccountBase()}/IncomingPhoneNumbers/${phoneNumberSid}.json`
    const res = await fetch(url, { headers: { Authorization: basicAuthHeader() } })
    if (!res.ok) return null
    const n: any = await res.json()
    return {
      phoneNumber: n.phone_number,
      smsUrl: n.sms_url,
      smsMethod: n.sms_method,
    }
  } catch (err) {
    console.error('[signalwire/get-webhook] threw:', (err as Error).message)
    return null
  }
}

/**
 * Wave 41 — re-point an existing SignalWire number's SMS webhook.
 * Used during practice setup / reprovision when the inbound URL needs to
 * change (e.g. a new app domain).
 */
export async function updatePhoneNumberWebhook(
  phoneNumberSid: string,
  smsUrl: string,
  smsMethod: 'GET' | 'POST' = 'POST',
): Promise<boolean> {
  if (!PROJECT_ID || !TOKEN || !SPACE_URL) return false
  try {
    const body = new URLSearchParams({ SmsUrl: smsUrl, SmsMethod: smsMethod })
    const url = `${laMLAccountBase()}/IncomingPhoneNumbers/${phoneNumberSid}.json`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })
    if (!res.ok) {
      console.error('[signalwire/update-webhook] http', res.status, (await res.text().catch(() => '')).slice(0, 200))
      return false
    }
    return true
  } catch (err) {
    console.error('[signalwire/update-webhook] threw:', (err as Error).message)
    return false
  }
}

/**
 * Wave 41 — TwiML/LaML response builder for inbound-SMS replies. Mirrors
 * the legacy lib/twilio.ts::generateSMSResponse exactly; SignalWire's
 * inbound-SMS handler accepts the same <Response><Message>...</Message></Response>
 * envelope as Twilio does. Re-exported under both names for caller parity.
 */
export function generateSMSResponse(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Message>${escapeXml(message)}</Message>
      </Response>`
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Wave 41 — pure E.164 normaliser. Carrier-agnostic; copied from the
 * legacy lib/twilio.ts so callers can swap import paths without behaviour
 * change.
 */
export function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length >= 11) return `+${digits}`
  return `+${digits}`
}

/**
 * Wave 41 — SignalWire inbound-SMS payload extractor. SignalWire LaML
 * mirrors Twilio's webhook field names (From / To / Body / MessageSid),
 * so the body of this helper is identical to the legacy
 * extractPhoneFromTwilioPayload — but having a SignalWire-named export
 * makes greppability + audit-trail accurate after the port.
 */
export function extractPhoneFromSignalWirePayload(payload: Record<string, any>): {
  from: string
  to: string
  body: string
  messageSid: string
} {
  return {
    from: payload.From || '',
    to: payload.To || '',
    body: payload.Body || '',
    messageSid: payload.MessageSid || '',
  }
}
