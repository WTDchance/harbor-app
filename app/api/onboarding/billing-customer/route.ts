// app/api/onboarding/billing-customer/route.ts
//
// POST — idempotently ensure the calling practice has a Stripe Customer.
// Called by /onboarding/billing on first load before the tier picker.
//
// Why a separate endpoint instead of inlining in signup:
//   * The existing /api/signup route is the legacy founding-member flow
//     (charge upfront, no trial). The new vendor-billing flow uses a
//     14-day trial via /api/billing/checkout-session. Both flows share
//     the same Stripe customer, so we keep customer-creation in this
//     small dedicated endpoint and call it from both paths.
//   * /api/signup already calls stripe.customers.create + stamps
//     stripe_customer_id. This endpoint is a no-op for those signups.
//
// PHI rule: only practice_id goes into Stripe metadata.

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
    `SELECT id, name, owner_email, billing_email, stripe_customer_id
       FROM practices WHERE id = $1 LIMIT 1`,
    [practiceId],
  )
  if (rows.length === 0) {
    return NextResponse.json({ error: 'practice_not_found' }, { status: 404 })
  }
  const practice = rows[0] as {
    id: string
    name: string
    owner_email: string | null
    billing_email: string | null
    stripe_customer_id: string | null
  }

  if (practice.stripe_customer_id) {
    return NextResponse.json({
      customer_id: practice.stripe_customer_id,
      created: false,
    })
  }

  const customer = await stripe.customers.create({
    email: practice.billing_email ?? practice.owner_email ?? undefined,
    name: practice.name,
    metadata: { practice_id: practice.id },
  })

  await pool.query(
    `UPDATE practices SET stripe_customer_id = $1 WHERE id = $2`,
    [customer.id, practice.id],
  )

  await auditSystemEvent({
    action: 'billing.customer.created',
    severity: 'info',
    practiceId,
    details: { stripe_customer_id: customer.id, source: 'onboarding' },
  })

  return NextResponse.json({ customer_id: customer.id, created: true })
}
