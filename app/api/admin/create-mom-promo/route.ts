// POST /api/admin/create-mom-promo
//
// One-time setup endpoint that provisions the MOM-FREE Stripe coupon and
// promotion code so Chance's mom (Hope and Harmony Counseling) can sign up
// for free. Idempotent: re-running returns the existing objects rather than
// duplicating them.
//
// Auth: requires the caller to be the admin (matches ADMIN_EMAIL env var).
//
// Once this has been called once, give your mom the code "MOM-FREE" and have
// her sign up at /signup with email dr.tracewonser@gmail.com — the signup
// route enforces the email match server-side.

import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase-server'

const COUPON_ID = 'mom_free_forever'
const PROMO_CODE = 'MOM-FREE'

async function isAdmin(req: NextRequest): Promise<boolean> {
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase()
  if (!adminEmail) return false
  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.email) return false
    return user.email.toLowerCase() === adminEmail
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  if (!stripe) {
    return NextResponse.json(
      { error: 'Stripe is not configured on the server.' },
      { status: 500 }
    )
  }

  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    // 1. Coupon: 100% off, forever. Idempotent via fixed id.
    let coupon
    try {
      coupon = await stripe.coupons.retrieve(COUPON_ID)
    } catch {
      coupon = await stripe.coupons.create({
        id: COUPON_ID,
        percent_off: 100,
        duration: 'forever',
        name: 'Mom — free forever',
      })
    }

    // 2. Promotion code: MOM-FREE, single-use.
    // Stripe enforces uniqueness on `code` per account, so list-and-reuse.
    const existing = await stripe.promotionCodes.list({
      code: PROMO_CODE,
      limit: 1,
    })
    let promo = existing.data[0]
    if (!promo) {
      promo = await stripe.promotionCodes.create({
        coupon: coupon.id,
        code: PROMO_CODE,
        max_redemptions: 1,
        active: true,
        metadata: {
          purpose: 'mom-free-forever',
          locked_to_email: 'dr.tracewonser@gmail.com',
        },
      })
    }

    return NextResponse.json({
      success: true,
      coupon: {
        id: coupon.id,
        percent_off: coupon.percent_off,
        duration: coupon.duration,
      },
      promotion_code: {
        id: promo.id,
        code: promo.code,
        active: promo.active,
        max_redemptions: promo.max_redemptions,
        times_redeemed: promo.times_redeemed,
      },
      note: 'Give MOM-FREE to mom. Signup is locked to dr.tracewonser@gmail.com server-side.',
    })
  } catch (err: any) {
    console.error('[create-mom-promo] failed:', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to create promo code' },
      { status: 500 }
    )
  }
}
