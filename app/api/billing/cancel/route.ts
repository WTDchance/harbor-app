// app/api/billing/cancel/route.ts
//
// POST — schedule cancellation at end of period (cancel_at_period_end=true).
// Does NOT delete the subscription; the practice keeps access until
// current_period_end so the founder doesn't strand patient data mid-cycle.

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
    `SELECT stripe_subscription_id FROM practice_subscriptions
      WHERE practice_id = $1 LIMIT 1`,
    [practiceId],
  )
  const stripeSubId = rows[0]?.stripe_subscription_id as string | null
  if (!stripeSubId) {
    return NextResponse.json({ error: 'no_active_subscription' }, { status: 400 })
  }

  const updated = await stripe.subscriptions.update(stripeSubId, {
    cancel_at_period_end: true,
  })

  await pool.query(
    `UPDATE practice_subscriptions
        SET cancel_at_period_end = TRUE
      WHERE practice_id = $1`,
    [practiceId],
  )

  await auditSystemEvent({
    action: 'billing.subscription.cancellation_scheduled',
    severity: 'warning',
    practiceId,
    resourceType: 'practice_subscription',
    resourceId: stripeSubId,
    details: {
      cancel_at_period_end: true,
      current_period_end: updated.current_period_end,
    },
  })

  return NextResponse.json({
    ok: true,
    cancel_at_period_end: true,
    current_period_end: updated.current_period_end,
  })
}
