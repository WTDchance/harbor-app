// app/api/billing/checkout-session/route.ts
//
// POST — mint a Stripe Checkout session for the calling practice's billing
// admin. Used by /onboarding/billing (first subscription, 14-day trial) and
// also by /dashboard/settings/billing for upgrade flows when the practice
// doesn't yet have a saved card.
//
// Body: { tier: HarborTierKey, mode?: 'first_sub' | 'upgrade' }
// Returns: { url } redirect URL to Stripe-hosted Checkout.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { stripe } from '@/lib/stripe'
import { requireBillingAdmin } from '@/lib/billing/auth'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import {
  getStripePriceId,
  HARBOR_PRICING_TIERS,
  type HarborTierKey,
} from '@/lib/billing/stripe-products'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP_URL =
  process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function POST(req: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 500 })
  }
  const ctx = await requireBillingAdmin()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = ctx.practiceId!

  let body: { tier?: HarborTierKey; mode?: 'first_sub' | 'upgrade' } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const tier = body.tier
  if (!tier || !(tier in HARBOR_PRICING_TIERS)) {
    return NextResponse.json({ error: 'invalid_tier' }, { status: 400 })
  }

  const priceId = getStripePriceId(tier)
  if (!priceId) {
    return NextResponse.json(
      {
        error: 'price_id_not_configured',
        env: HARBOR_PRICING_TIERS[tier].stripe_price_id_env,
      },
      { status: 500 },
    )
  }

  // Resolve / ensure a Stripe customer for this practice. The signup flow
  // already creates one; this is the safety net for older practices that
  // pre-date the customer creation in signup.
  const practiceRow = await pool.query(
    `SELECT id, name, owner_email, billing_email, stripe_customer_id
       FROM practices WHERE id = $1 LIMIT 1`,
    [practiceId],
  )
  if (practiceRow.rows.length === 0) {
    return NextResponse.json({ error: 'practice_not_found' }, { status: 404 })
  }
  const practice = practiceRow.rows[0] as {
    id: string
    name: string
    owner_email: string | null
    billing_email: string | null
    stripe_customer_id: string | null
  }
  let customerId = practice.stripe_customer_id

  if (!customerId) {
    const created = await stripe.customers.create({
      email: practice.billing_email ?? practice.owner_email ?? undefined,
      name: practice.name,
      metadata: { practice_id: practice.id },
    })
    customerId = created.id
    await pool.query(
      `UPDATE practices SET stripe_customer_id = $1 WHERE id = $2`,
      [customerId, practice.id],
    )
  }

  // Has this practice ever subscribed? If not, attach a 14-day trial.
  const existing = await pool.query(
    `SELECT id FROM practice_subscriptions WHERE practice_id = $1 LIMIT 1`,
    [practiceId],
  )
  const isFirstSub = existing.rows.length === 0

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${APP_URL.replace(/\/$/, '')}/dashboard/settings/billing?checkout=success`,
    cancel_url: `${APP_URL.replace(/\/$/, '')}/dashboard/settings/billing?checkout=cancel`,
    billing_address_collection: 'required',
    allow_promotion_codes: true,
    subscription_data: {
      // PHI rule: only practice_id in metadata. No patient/clinical fields.
      metadata: { practice_id: practiceId, tier },
      ...(isFirstSub ? { trial_period_days: 14 } : {}),
    },
    metadata: { practice_id: practiceId, tier, mode: isFirstSub ? 'first_sub' : 'upgrade' },
  })

  await auditSystemEvent({
    action: 'billing.checkout_session.created',
    severity: 'info',
    practiceId,
    details: {
      tier,
      stripe_price_id: priceId,
      session_id: session.id,
      first_sub: isFirstSub,
    },
  })

  return NextResponse.json({ url: session.url, session_id: session.id })
}
