// Mint new Stripe recurring Price objects at the updated founding/regular
// tiers, then expose their IDs so they can be wired into Railway env vars
// (STRIPE_PRICE_ID_FOUNDING / STRIPE_PRICE_ID_REGULAR).
//
// Stripe prices are immutable once created, so bumping price = create new
// Price objects + point the env vars at them. Existing subscribers keep
// their old price (they were subscribed to the old Price ID). New checkouts
// use the new Price IDs once env vars are updated.
//
// POST /api/admin/stripe-mint-prices
//   Headers: Authorization: Bearer <CRON_SECRET>
//   Body (optional): { productName?: "Harbor Receptionist" }
//
// Returns: { founding: { id, unit_amount, nickname }, regular: {...} }

import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") || ""
  const expected = "Bearer " + (process.env.CRON_SECRET || "")
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return NextResponse.json({ error: "STRIPE_SECRET_KEY not configured" }, { status: 500 })

  const stripe = new Stripe(key, { apiVersion: "2024-06-20" as any })

  const body = await req.json().catch(() => ({}))
  const productName = body?.productName || "Harbor Receptionist"

  // 1. Find or create a Product to hang the new prices on. We reuse whatever
  // product the existing founding Price is associated with so invoices stay
  // grouped under a single product.
  let productId: string | undefined
  try {
    const existingFoundingId = process.env.STRIPE_PRICE_ID_FOUNDING
    if (existingFoundingId) {
      const existingPrice = await stripe.prices.retrieve(existingFoundingId)
      productId = typeof existingPrice.product === "string" ? existingPrice.product : existingPrice.product?.id
    }
  } catch (err: any) {
    console.warn("[stripe-mint-prices] could not read existing founding price:", err?.message)
  }
  if (!productId) {
    const product = await stripe.products.create({ name: productName })
    productId = product.id
  }

  // 2. Mint the two new recurring prices
  const founding = await stripe.prices.create({
    product: productId,
    currency: "usd",
    unit_amount: 39700,
    recurring: { interval: "month" },
    nickname: "Founding Practice - $397/mo (2026-04 pricing)",
    lookup_key: "harbor_founding_397_mo",
    transfer_lookup_key: true,
  })

  const regular = await stripe.prices.create({
    product: productId,
    currency: "usd",
    unit_amount: 59700,
    recurring: { interval: "month" },
    nickname: "Standard Practice - $597/mo (2026-04 pricing)",
    lookup_key: "harbor_regular_597_mo",
    transfer_lookup_key: true,
  })

  return NextResponse.json({
    ok: true,
    product_id: productId,
    founding: { id: founding.id, unit_amount: founding.unit_amount, nickname: founding.nickname, lookup_key: founding.lookup_key },
    regular: { id: regular.id, unit_amount: regular.unit_amount, nickname: regular.nickname, lookup_key: regular.lookup_key },
    next_steps: [
      "Update Railway env var STRIPE_PRICE_ID_FOUNDING to the founding.id above.",
      "Update Railway env var STRIPE_PRICE_ID_REGULAR to the regular.id above.",
      "Redeploy harbor-app. Existing subscribers keep their old price (grandfathered).",
    ],
  })
}
