// app/api/ehr/assessment-schedules/[id]/route.ts
//
// Wave 22 (AWS port). Stop or resume / change cadence on a schedule.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { id } = await params
  const body = await req.json().catch(() => null)

  const sets: string[] = []
  const args: any[] = [id, ctx.practiceId]
  if (typeof body?.is_active === 'boolean') {
    args.push(body.is_active)
    sets.push(`is_active = $${args.length}`)
  }
  if (Number.isInteger(body?.cadence_weeks)) {
    args.push(body.cadence_weeks)
    sets.push(`cadence_weeks = $${args.length}`)
  }
  if (sets.length === 0) return NextResponse.json({ error: 'No updatable fields' }, { status: 400 })

  try {
    const { rows } = await pool.query(
      `UPDATE ehr_assessment_schedules SET ${sets.join(', ')}
        WHERE id = $1 AND practice_id = $2
        RETURNING *`,
      args,
    )
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ schedule: rows[0] })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
