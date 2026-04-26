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
  const hmac = createHmac('sha1', TOKEN).update(buf).digest('base64')
  return { buf, hmac }
}

export function validateInboundWebhook(args: {
  rawUrl: string
  formParams: Record<string, string>
  signatureHeader: string | null | undefined
}): boolean {
  if (!TOKEN) return false
  if (!args.signatureHeader) return false
  if (process.env.SIGNALWIRE_VALIDATE_INBOUND === 'false') return true

  const { hmac } = computeWebhookSignature({
    rawUrl: args.rawUrl,
    formParams: args.formParams,
  })
  return hmac === args.signatureHeader
}

/**
 * Build a LaML/TwiML response that hands the inbound call off to
 * Retell's media-stream endpoint. The agent_id is encoded in the
 * stream URL query string per Retell's docs.
 *
 * Retell's media-stream URL pattern:
 *   wss://api.retellai.com/v2/agent/<agent_id>/audio
 */
export function laMLConnectToRetell(args: {
  agentId: string
  callMetadata?: Record<string, string>
}): string {
  const params = new URLSearchParams()
  params.set('agent_id', args.agentId)
  for (const [k, v] of Object.entries(args.callMetadata ?? {})) {
    params.set(k, v)
  }
  const streamUrl = `wss://api.retellai.com/v2/agent/${args.agentId}/audio`
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
