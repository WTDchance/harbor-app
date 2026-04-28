// app/api/twilio/forward/route.ts
//
// Wave 27d — Carrier swap. Inbound voice routing has moved to
// SignalWire + Retell. SignalWire's voice webhook now lives at
// /api/signalwire/inbound-voice. Twilio numbers that still point
// here will get a Hangup TwiML so we don't silently dead-end.
//
// This file is kept (rather than deleted) so any stale Twilio
// dashboard config that still POSTs here surfaces a graceful failure
// rather than a 404, and so Lift's audit trail shows the deprecation
// rather than missing routes.

import { NextRequest, NextResponse } from 'next/server'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

const TWIML_HEADERS = { 'Content-Type': 'application/xml' }

const DEPRECATED_TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">This number has moved. Please update your call routing to the new endpoint and try again.</Say>
  <Hangup/>
</Response>`

async function handle(req: NextRequest, method: string) {
  await auditSystemEvent({
    action: 'twilio.forward.deprecated_hit',
    severity: 'warning',
    details: { method, ua: req.headers.get('user-agent') ?? null },
  })
  return new NextResponse(DEPRECATED_TWIML, { status: 200, headers: TWIML_HEADERS })
}

export async function GET(req: NextRequest) { return handle(req, 'GET') }
export async function POST(req: NextRequest) { return handle(req, 'POST') }
