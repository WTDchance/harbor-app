// W51 D4 — fire a test webhook (synthetic lead payload).

import { NextResponse } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { deliverLeadEvent } from '@/lib/lead-webhooks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 400 })

  await deliverLeadEvent('lead.created', {
    id: '00000000-0000-0000-0000-000000000000',
    practice_id: ctx.practiceId,
    status: 'new',
    first_name: 'Test',
    last_name: 'Patient',
    date_of_birth: null,
    phone_e164: '+15555550100',
    email: 'test@example.com',
    insurance_payer: 'Aetna',
    reason_for_visit: 'Webhook smoke test from Harbor.',
    urgency_level: 'low',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  return NextResponse.json({ ok: true, sent: 'lead.created' })
}
