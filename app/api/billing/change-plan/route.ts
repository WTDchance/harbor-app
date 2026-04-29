// app/api/billing/change-plan/route.ts
//
// POST — switch the practice to a different Harbor tier. Calls
// stripe.subscriptions.update with proration_behavior='create_prorations'
// so a mid-cycle upgrade is billed prorated immediately.
//
// Body: { tier: HarborTierKey }

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

export async function POST(req: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 500 })
  }
  const ctx = await requireBillingAdmin()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = ctx.practiceId!

  let body: { tier?: HarborTierKey } = {}
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

  const { rows } = await pool.query(
    `SELECT stripe_subscription_id, tier FROM practice_subscriptions
      WHERE practice_id = $1 LIMIT 1`,
    [practiceId],
  )
  const sub = rows[0] as { stripe_subscription_id: string | null; tier: string } | undefined
  if (!sub?.stripe_subscription_id) {
    return NextResponse.json({ error: 'no_active_subscription' }, { status: 400 })
  }
  if (sub.tier === tier) {
    return NextResponse.json({ ok: true, no_change: true })
  }

  // Find the subscription item id (Stripe needs item id, not price id, on update).
  const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id)
  const itemId = stripeSub.items.data[0]?.id
  if (!itemId) {
    return NextResponse.json({ error: 'subscription_has_no_items' }, { status: 500 })
  }

  const updated = await stripe.subscriptions.update(sub.stripe_subscription_id, {
    items: [{ id: itemId, price: priceId }],
    proration_behavior: 'create_prorations',
    metadata: { practice_id: practiceId, tier },
  })

  // Webhook will mirror the change into practice_subscriptions, but stamp
  // the new tier locally too so the UI shows the new plan immediately.
  await pool.query(
    `UPDATE practice_subscriptions
        SET tier = $1, stripe_price_id = $2
      WHERE practice_id = $3`,
    [tier, priceId, practiceId],
  )

  await auditSystemEvent({
    action: 'billing.subscription.plan_changed',
    severity: 'info',
    practiceId,
    resourceType: 'practice_subscription',
    resourceId: sub.stripe_subscription_id,
    details: {
      from_tier: sub.tier,
      to_tier: tier,
      stripe_price_id: priceId,
      proration: 'create_prorations',
      stripe_status: updated.status,
    },
  })

  return NextResponse.json({ ok: true, tier, status: updated.status })
}
