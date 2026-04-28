// app/api/twilio/sms-webhook/route.ts
//
// Wave 27d — Carrier swap. Inbound SMS now arrives at
// /api/signalwire/inbound-sms. Stale Twilio config that still POSTs
// here gets logged as deprecated and answered with empty TwiML so
// no auto-reply is sent.

import { NextRequest, NextResponse } from 'next/server'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

const TWIML_HEADERS = { 'Content-Type': 'application/xml' }

export async function POST(req: NextRequest) {
  await auditSystemEvent({
    action: 'twilio.sms_webhook.deprecated_hit',
    severity: 'warning',
    details: { ua: req.headers.get('user-agent') ?? null },
  })
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response/>`, {
    status: 200,
    headers: TWIML_HEADERS,
  })
}
