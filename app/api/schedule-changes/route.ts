// app/api/schedule-changes/route.ts
//
// Wave 23 (AWS port). Read-only list of pending schedule changes
// (reschedule / cancel / no-show) for the practice. SMS dispatch on
// confirm/decline lives in Bucket 1 — the existing
// /api/schedule-changes/[id]/confirm route persists state and the
// carrier worker (Bucket 1) consumes the queue.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { getEffectivePracticeId } from '@/lib/active-practice'

export async function GET(request: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const status = request.nextUrl.searchParams.get('status')
  const args: any[] = [practiceId]
  let where = `practice_id = $1`
  if (status) {
    args.push(status)
    where += ` AND status = $${args.length}`
  }
  try {
    const { rows } = await pool.query(
      `SELECT * FROM schedule_changes WHERE ${where} ORDER BY created_at DESC LIMIT 100`,
      args,
    )
    return NextResponse.json({ changes: rows })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
