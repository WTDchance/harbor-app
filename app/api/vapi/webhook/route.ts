// app/api/vapi/webhook/route.ts
//
// Wave 41 — Vapi retired. Retell is the receptionist; the canonical
// post-call webhook now lives at /api/retell/webhook (call lifecycle +
// crisis detection + recording_url + summary all sourced from Retell's
// call_analysis payload).
//
// This file is kept (rather than deleted) so any stale Vapi assistant
// or phone-number config that still POSTs the legacy assistant-request /
// end-of-call-report payloads surfaces a graceful 200 (Vapi retries
// non-2xx three times — we don't want retry storms during cutover) plus
// an audit row, instead of a 404. Mirrors the deprecation-shim pattern
// established for /api/twilio/forward and /api/twilio/sms-webhook.
//
// SAFE TO DELETE once audit_logs shows zero `vapi.webhook.deprecated_hit`
// rows for 90 days (recommended one quarter past last hit, per the
// twilio-vapi-scrub Phase A audit).

import { NextRequest, NextResponse } from 'next/server'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

async function handle(req: NextRequest, method: string) {
  // Best-effort: capture the message type so we can see what kinds of
  // events Vapi is still firing (assistant-request vs end-of-call-report
  // vs status-update). Works for both raw text + JSON bodies; we don't
  // parse aggressively because Vapi retries on any 5xx.
  let messageType: string | null = null
  try {
    const ct = (req.headers.get('content-type') || '').toLowerCase()
    if (ct.includes('application/json')) {
      const j = (await req.clone().json().catch(() => null)) as any
      messageType = j?.message?.type ?? j?.type ?? null
    }
  } catch {
    // swallow — observability-only
  }

  await auditSystemEvent({
    action: 'vapi.webhook.deprecated_hit',
    severity: 'warning',
    details: {
      method,
      message_type: messageType,
      ua: req.headers.get('user-agent') ?? null,
    },
  }).catch(() => {})

  // Empty 200 — Vapi will accept any 2xx and stop retrying.
  return NextResponse.json({ ok: true, deprecated: true })
}

export async function GET(req: NextRequest) { return handle(req, 'GET') }
export async function POST(req: NextRequest) { return handle(req, 'POST') }
