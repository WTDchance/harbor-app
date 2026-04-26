// Confirm or revert a pending schedule_changes row.
// POST /api/schedule-changes/[id]/confirm  body: { action: 'confirm' | 'revert' }
//
// 'confirm' applies the change (rescheduled → updates appointments.scheduled_for;
// cancelled → flips appointments.status to 'cancelled') and marks the row
// confirmed.
// 'revert' just marks the row reverted; appointment row is untouched.

import { NextResponse, type NextRequest } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Action = 'confirm' | 'revert'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) {
    return NextResponse.json({ error: 'no_practice' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => null) as { action?: Action } | null
  const action = body?.action
  if (action !== 'confirm' && action !== 'revert') {
    return NextResponse.json(
      { error: 'action must be "confirm" or "revert"' },
      { status: 400 },
    )
  }

  const lookup = await pool.query(
    `SELECT id, appointment_id, change_type, new_time, status
       FROM schedule_changes
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, ctx.practiceId],
  )
  const change = lookup.rows[0]
  if (!change) {
    return NextResponse.json({ error: 'Change not found' }, { status: 404 })
  }
  if (change.status !== 'pending') {
    return NextResponse.json(
      { error: `Change is already ${change.status}` },
      { status: 400 },
    )
  }

  if (action === 'confirm') {
    await pool.query(
      `UPDATE schedule_changes
          SET status = 'confirmed', confirmed_at = NOW()
        WHERE id = $1`,
      [id],
    )
    if (change.change_type === 'rescheduled' && change.appointment_id && change.new_time) {
      // AWS canonical column is scheduled_for, not scheduled_at.
      await pool.query(
        `UPDATE appointments SET scheduled_for = $1, updated_at = NOW()
          WHERE id = $2 AND practice_id = $3`,
        [change.new_time, change.appointment_id, ctx.practiceId],
      ).catch(err => console.error('[schedule-changes/confirm] appt reschedule failed', err))
    } else if (change.change_type === 'cancelled' && change.appointment_id) {
      await pool.query(
        `UPDATE appointments SET status = 'cancelled', updated_at = NOW()
          WHERE id = $1 AND practice_id = $2`,
        [change.appointment_id, ctx.practiceId],
      ).catch(err => console.error('[schedule-changes/confirm] appt cancel failed', err))
    }
    return NextResponse.json({ success: true, status: 'confirmed' })
  }

  // revert
  await pool.query(
    `UPDATE schedule_changes
        SET status = 'reverted'
      WHERE id = $1`,
    [id],
  )
  // TODO: notify patient that the change was not approved (deferred to
  // notification fan-out wave).
  return NextResponse.json({ success: true, status: 'reverted' })
}
