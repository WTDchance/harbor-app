// app/api/billing/subscription/route.ts
//
// GET — return the practice's current subscription mirror + the most recent
// invoices. Powers /dashboard/settings/billing.

import { NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireBillingAdmin } from '@/lib/billing/auth'
import { HARBOR_PRICING_TIERS } from '@/lib/billing/stripe-products'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireBillingAdmin()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = ctx.practiceId!

  const sub = await pool.query(
    `SELECT * FROM practice_subscriptions WHERE practice_id = $1 LIMIT 1`,
    [practiceId],
  )
  const subscription = sub.rows[0] ?? null

  const invoices = await pool.query(
    `SELECT id, stripe_invoice_id, stripe_invoice_number,
            amount_due_cents, amount_paid_cents, currency, status,
            invoice_pdf_url, hosted_invoice_url, paid_at, due_date, created_at
       FROM practice_invoices
      WHERE practice_id = $1
      ORDER BY created_at DESC
      LIMIT 24`,
    [practiceId],
  )

  const practice = await pool.query(
    `SELECT id, name, status, stripe_customer_id FROM practices WHERE id = $1`,
    [practiceId],
  )

  const tier = subscription
    ? HARBOR_PRICING_TIERS[subscription.tier as keyof typeof HARBOR_PRICING_TIERS] ?? null
    : null

  return NextResponse.json({
    practice: practice.rows[0] ?? null,
    subscription,
    tier,
    invoices: invoices.rows,
    catalog: HARBOR_PRICING_TIERS,
  })
}
