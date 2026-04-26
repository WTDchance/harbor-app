// app/api/admin/create-mom-promo/route.ts
//
// Wave 23 (AWS port). Admin-only — provisions the MOM-FREE Stripe
// promotion code (one-time setup). Cognito admin session.

import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

const MOM_PROMO_CODE = 'MOM-FREE'

export async function POST(_req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })

  try {
    // Check existing
    const existing = await stripe.promotionCodes.list({
      code: MOM_PROMO_CODE,
      limit: 1,
      active: true,
    })
    if (existing.data[0]) {
      return NextResponse.json({ ok: true, already_exists: true, id: existing.data[0].id })
    }

    // Need a 100% off coupon first
    const coupon = await stripe.coupons.create({
      percent_off: 100,
      duration: 'forever',
      name: 'MOM Free Lifetime',
    })
    const promo = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code: MOM_PROMO_CODE,
      max_redemptions: 1,
    })
    await auditEhrAccess({
      ctx,
      action: 'admin.run_migration',
      resourceType: 'stripe_promotion_code',
      resourceId: promo.id,
      details: { admin_email: ctx.session.email, code: MOM_PROMO_CODE, coupon_id: coupon.id },
    })
    return NextResponse.json({ ok: true, id: promo.id, coupon_id: coupon.id })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
