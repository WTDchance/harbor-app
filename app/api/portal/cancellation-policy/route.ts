// app/api/portal/cancellation-policy/route.ts
//
// Wave 42 — Patient-facing read of the practice's cancellation policy.
// Returns the policy hours, fee amounts, and human-readable disclosure
// text bound to the patient's authenticated portal session. The portal
// schedule + cancel surfaces consume this so they can show "you have
// less than N hours' notice → $X fee" before the patient confirms.
//
// No PHI in the response — this is practice configuration only.

import { NextResponse } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const { rows } = await pool.query(
    `SELECT cancellation_policy_hours,
            cancellation_fee_cents,
            no_show_fee_cents,
            cancellation_policy_text
       FROM practices
      WHERE id = $1
      LIMIT 1`,
    [sess.practiceId],
  )
  const r = rows[0]
  if (!r) return NextResponse.json({ error: 'practice_not_found' }, { status: 404 })
  return NextResponse.json({
    policy_hours: r.cancellation_policy_hours,
    cancellation_fee_cents: r.cancellation_fee_cents,
    no_show_fee_cents: r.no_show_fee_cents,
    policy_text: r.cancellation_policy_text,
  })
}
