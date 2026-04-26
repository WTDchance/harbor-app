// app/api/admin/signups/[id]/retry/route.ts
//
// Wave 23 (AWS port). Admin-only — retry the carrier provisioning
// for a stuck signup. Carrier side (Vapi assistant + Twilio number
// purchase) is Bucket 1, so we surface a 501 with a clear reason.
// The DB-side retry (re-running the Stripe webhook handler) doesn't
// have a clean entry point on AWS yet — we stub it the same way.

import { NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/aws/api-auth'

export async function POST() {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx
  return NextResponse.json(
    {
      error: 'not_implemented',
      reason: 'carrier_swap_in_progress',
      detail:
        'Signup retry triggers Vapi assistant + Twilio number provisioning. ' +
        'Both move to the Retell + SignalWire migration (Bucket 1).',
    },
    { status: 501 },
  )
}
