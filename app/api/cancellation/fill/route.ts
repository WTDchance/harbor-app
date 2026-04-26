// app/api/cancellation/fill/route.ts
//
// Wave 23 (AWS port). DB-side enqueue of a cancellation-fill request.
// SMS blast to the waitlist is on Bucket 1 — the
// /api/cron/cancellation-dispatch route (Wave 8 — already AWS-ported)
// processes the queue.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { getEffectivePracticeId } from '@/lib/active-practice'

export async function POST(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { appointment_id, slot_at, duration_minutes } = body
  if (!appointment_id || !slot_at) {
    return NextResponse.json({ error: 'appointment_id and slot_at required' }, { status: 400 })
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO cancellation_fills
          (practice_id, appointment_id, slot_at, duration_minutes, status, queued_at)
        VALUES ($1, $2, $3, $4, 'queued', NOW())
        RETURNING id, status`,
      [practiceId, appointment_id, slot_at, duration_minutes ?? 45],
    )
    return NextResponse.json({
      ok: true,
      fill_id: rows[0].id,
      status: rows[0].status,
      dispatch_pending: 'cancellation-dispatch_cron',
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
