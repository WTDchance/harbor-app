// app/api/practices/forwarding/route.ts
//
// Wave 23 (AWS port). DB-side read + write of practice call-forwarding
// settings. Twilio-side enable/disable was the legacy POST behavior;
// that side-effect lives in Bucket 1 (Retell + SignalWire migration)
// and is intentionally not replayed here. We persist the
// forwarding_enabled + call_forwarding_number columns so the dashboard
// reflects truth — Bucket 1 will pick up the persisted state when it
// wires the carrier.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { getEffectivePracticeId } from '@/lib/active-practice'

export async function GET(_req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx

  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

  try {
    const { rows } = await pool.query(
      `SELECT forwarding_enabled, call_forwarding_number
         FROM practices WHERE id = $1 LIMIT 1`,
      [practiceId],
    )
    if (rows.length === 0) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
    return NextResponse.json({
      forwarding_enabled: rows[0].forwarding_enabled || false,
      call_forwarding_number: rows[0].call_forwarding_number || null,
    })
  } catch {
    // Columns might not exist yet in older RDS — return defaults.
    return NextResponse.json({ forwarding_enabled: false, call_forwarding_number: null })
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx

  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

  const { enabled, forwarding_number } = await req.json().catch(() => ({}))
  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
  }
  const num = typeof forwarding_number === 'string' ? forwarding_number.trim() : null

  try {
    await pool.query(
      `UPDATE practices
          SET forwarding_enabled = $1,
              call_forwarding_number = $2
        WHERE id = $3`,
      [enabled, enabled ? num : null, practiceId],
    )
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    forwarding_enabled: enabled,
    call_forwarding_number: enabled ? num : null,
    carrier_sync: 'deferred_to_bucket_1',
  })
}
