// app/api/twilio/available-numbers/route.ts
//
// Wave 41 — deprecation shim. The signup flow's available-numbers
// search has moved to /api/phone-numbers/search (SignalWire-backed).
// We keep this URL alive as a 410 Gone with the replacement target so
// any cached frontend bundle still hitting this path gets a clean,
// audited tombstone instead of a 500.
//
// SAFE TO DELETE once audit_logs shows zero
// `twilio.available_numbers.deprecated_hit` rows for 90 days, same
// retention guideline as the other /api/twilio/* deprecation shims.

import { NextRequest, NextResponse } from 'next/server'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

export async function GET(req: NextRequest) {
  await auditSystemEvent({
    action: 'twilio.available_numbers.deprecated_hit',
    severity: 'warn',
    details: {
      method: 'GET',
      ua: req.headers.get('user-agent') ?? null,
      area_code: req.nextUrl.searchParams.get('areaCode'),
    },
  }).catch(() => {})

  return NextResponse.json(
    {
      error: 'gone',
      reason: 'twilio_search_retired_wave_41',
      replacement: '/api/phone-numbers/search',
      docs: 'POST /api/phone-numbers/search { area_code | state | city | zip_code } — SignalWire-backed.',
    },
    { status: 410 },
  )
}
