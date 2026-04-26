// app/api/ehr/appointments/[id]/session/route.ts
//
// Wave 22 (AWS port). Start / stop / read the actual-session timer on
// an appointment. Does NOT touch scheduled times — stamps
// actual_started_at / actual_ended_at separately so plan-vs-reality
// is preserved.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  const { rows } = await pool.query(
    `SELECT id, actual_started_at, actual_ended_at FROM appointments
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, ctx.practiceId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({
    started_at: rows[0].actual_started_at,
    ended_at: rows[0].actual_ended_at,
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = body?.action

  let sql: string
  let args: any[]
  if (action === 'start') {
    sql = `UPDATE appointments SET actual_started_at = NOW(), actual_ended_at = NULL
            WHERE id = $1 AND practice_id = $2
            RETURNING id, actual_started_at, actual_ended_at`
    args = [id, ctx.practiceId]
  } else if (action === 'stop') {
    sql = `UPDATE appointments SET actual_ended_at = NOW()
            WHERE id = $1 AND practice_id = $2
            RETURNING id, actual_started_at, actual_ended_at`
    args = [id, ctx.practiceId]
  } else if (action === 'reset') {
    sql = `UPDATE appointments SET actual_started_at = NULL, actual_ended_at = NULL
            WHERE id = $1 AND practice_id = $2
            RETURNING id, actual_started_at, actual_ended_at`
    args = [id, ctx.practiceId]
  } else {
    return NextResponse.json({ error: 'action must be start | stop | reset' }, { status: 400 })
  }

  try {
    const { rows } = await pool.query(sql, args)
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({
      started_at: rows[0].actual_started_at,
      ended_at: rows[0].actual_ended_at,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
