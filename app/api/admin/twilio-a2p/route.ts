// app/api/admin/twilio-a2p/route.ts
//
// Wave 41 — Twilio retired. A2P 10DLC campaign management is per-carrier.
// SignalWire campaigns are project-scoped (one approved campaign covers
// every number in the project) and configured in the SignalWire console;
// there is no per-number bind step equivalent to Twilio's Messaging
// Service attach/detach. So no SignalWire-side replacement endpoint is
// needed.
//
// We keep this URL alive as a 410 Gone with guidance so any documented
// runbook still calling it gets a deterministic, audited tombstone.
//
// SAFE TO DELETE once audit_logs shows zero
// `twilio.a2p.deprecated_hit` rows for 90 days.

import { NextRequest, NextResponse } from 'next/server'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

async function handle(req: NextRequest, method: string) {
  await auditSystemEvent({
    action: 'twilio.a2p.deprecated_hit',
    severity: 'warn',
    details: {
      method,
      ua: req.headers.get('user-agent') ?? null,
      action: req.nextUrl.searchParams.get('action'),
    },
  }).catch(() => {})

  return NextResponse.json(
    {
      error: 'gone',
      reason: 'twilio_retired_wave_41',
      replacement: 'signalwire_console',
      docs: 'A2P 10DLC campaigns on SignalWire are project-scoped and configured in the SignalWire console (Campaigns → US 10DLC). No per-number binding endpoint is needed; numbers in the project automatically inherit the approved campaign.',
    },
    { status: 410 },
  )
}

export async function GET(req: NextRequest) { return handle(req, 'GET') }
export async function POST(req: NextRequest) { return handle(req, 'POST') }
