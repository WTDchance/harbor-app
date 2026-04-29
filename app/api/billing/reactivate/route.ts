// app/api/billing/reactivate/route.ts
//
// POST — reverse a scheduled cancellation by setting
// cancel_at_period_end=false. Does NOT resurrect a subscription that has
// already lapsed past current_period_end (Stripe rejects that — the
// practice would need to re-subscribe via /api/billing/checkout-session).

import { NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { stripe } from '@/lib/stripe'
import { requireBillingAdmin } from '@/lib/billing/auth'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  if (!stripe) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 500 })
  }
  const ctx = await requireBillingAdmin()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = ctx.practiceId!

  const { rows } = await pool.query(
    `SELECT stripe_subscription_id, cancel_at_period_end
       FROM practice_subscriptions WHERE practice_id = $1 LIMIT 1`,
    [practiceId],
  )
  const sub = rows[0] as
    | { stripe_subscription_id: string | null; cancel_at_period_end: boolean }
    | undefined
  if (!sub?.stripe_subscription_id) {
    return NextResponse.json({ error: 'no_active_subscription' }, { status: 400 })
  }
  if (!sub.cancel_at_period_end) {
    return NextResponse.json({ ok: true, already_active: true })
  }

  const updated = await stripe.subscriptions.update(sub.stripe_subscription_id, {
    cancel_at_period_end: false,
  })

  await pool.query(
    `UPDATE practice_subscriptions
        SET cancel_at_period_end = FALSE
      WHERE practice_id = $1`,
    [practiceId],
  )

  await auditSystemEvent({
    action: 'billing.subscription.reactivated',
    severity: 'info',
    practiceId,
    resourceType: 'practice_subscription',
    resourceId: sub.stripe_subscription_id,
    details: { stripe_status: updated.status },
  })

  return NextResponse.json({ ok: true, status: updated.status })
}
