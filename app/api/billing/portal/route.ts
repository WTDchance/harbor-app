// Stripe Customer Portal session mint.
//
// POST body: { email }   (the practice owner's email — looks up by canonical
//                          owner_email, with notification_email fallback for
//                          legacy clusters).
// Returns:   { url } — Stripe-hosted portal URL the dashboard redirects to.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { stripe } from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { email?: string } | null
  const email = body?.email?.trim()
  if (!email) {
    return NextResponse.json({ error: 'Missing required field: email' }, { status: 400 })
  }
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
  }

  // Lookup by owner_email (AWS canonical) with notification_email fallback.
  let practice: { id: string; stripe_customer_id: string | null } | null = null
  try {
    const { rows } = await pool.query(
      `SELECT id, stripe_customer_id FROM practices
        WHERE LOWER(owner_email) = LOWER($1) LIMIT 1`,
      [email],
    )
    practice = rows[0] ?? null
  } catch { /* canonical column missing — fall through */ }
  if (!practice) {
    try {
      const { rows } = await pool.query(
        `SELECT id, stripe_customer_id FROM practices
          WHERE LOWER(notification_email) = LOWER($1) LIMIT 1`,
        [email],
      )
      practice = rows[0] ?? null
    } catch { /* legacy column missing too */ }
  }

  if (!practice) {
    return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
  }
  if (!practice.stripe_customer_id) {
    return NextResponse.json(
      { error: 'No Stripe customer found for this practice' },
      { status: 400 },
    )
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: practice.stripe_customer_id,
    return_url: `${APP_URL.replace(/\/$/, '')}/dashboard/billing`,
  })

  // Audit (system event — no Cognito user gates this, only the practice email).
  pool.query(
    `INSERT INTO audit_logs (
       user_id, user_email, practice_id, action, resource_type, details
     ) VALUES (NULL, $1, $2, 'billing.portal.session', 'stripe_billing_portal', $3::jsonb)`,
    [email, practice.id, JSON.stringify({ session_id: session.id })],
  ).catch(() => {})

  console.log(`[billing/portal] session created ${session.id} for ${email}`)

  return NextResponse.json({ url: session.url })
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/billing/portal',
    description: 'Create a Stripe Customer Portal session',
    required_fields: ['email'],
  })
}
