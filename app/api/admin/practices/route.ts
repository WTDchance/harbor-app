// Admin practice-management endpoint (cron + ops triage).
//
// Auth: Bearer ${CRON_SECRET} — NOT a Cognito user session, so external
// cron / scripts can hit it.
//
// GET  /api/admin/practices
//   → { total, practices: [...] }
//
// DELETE was previously here for cascade-deletion + Vapi/Twilio external
// cleanup. Held back from this batch because of the external side effects
// (deleteVapiAssistant + releaseTwilioNumber) — see TODO below.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  // Columns aligned to the AWS canonical practices schema (infra/sql/schema.sql).
  const { rows } = await pool.query(
    `SELECT id, name, slug, owner_email, phone, timezone,
            provisioning_state, founding_member,
            stripe_customer_id, stripe_subscription_id, stripe_price_id, plan,
            vapi_assistant_id, vapi_phone_number_id, voice_provider,
            twilio_phone_number, twilio_phone_sid, signalwire_number,
            created_at, updated_at
       FROM practices
      ORDER BY created_at DESC`,
  )

  return NextResponse.json({
    total: rows.length,
    practices: rows,
  })
}

// TODO(phase-4b): port DELETE — cascade-delete the practice row plus
// best-effort cleanup of external resources (Vapi assistant via
// deleteVapiAssistant, Twilio number via releaseTwilioNumber). Stripe
// subscription is intentionally NOT auto-cancelled; surface it in the
// response for manual revocation.
export async function DELETE() {
  return NextResponse.json(
    { error: 'practice_delete_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
