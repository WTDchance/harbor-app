// app/api/billing/portal-session/route.ts
//
// POST — mint a Stripe-hosted Customer Portal session for the calling
// practice. Distinct from the legacy /api/billing/portal endpoint:
//   * gated by requireBillingAdmin (Cognito session, owner/admin role)
//   * resolves the customer from the auth context, NOT a body param
// The legacy endpoint stays in place for the support-tools email-lookup flow.

import { NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { stripe } from '@/lib/stripe'
import { requireBillingAdmin } from '@/lib/billing/auth'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP_URL =
  process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function POST() {
  if (!stripe) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 500 })
  }
  const ctx = await requireBillingAdmin()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = ctx.practiceId!

  const { rows } = await pool.query(
    `SELECT stripe_customer_id FROM practices WHERE id = $1 LIMIT 1`,
    [practiceId],
  )
  const customerId = rows[0]?.stripe_customer_id as string | null
  if (!customerId) {
    return NextResponse.json(
      { error: 'no_stripe_customer' },
      { status: 400 },
    )
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${APP_URL.replace(/\/$/, '')}/dashboard/settings/billing`,
  })

  await auditSystemEvent({
    action: 'billing.portal_session.created',
    severity: 'info',
    practiceId,
    details: { session_id: session.id },
  })

  return NextResponse.json({ url: session.url })
}
