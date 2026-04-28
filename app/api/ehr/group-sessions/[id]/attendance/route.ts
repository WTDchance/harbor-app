// app/api/ehr/group-sessions/[id]/attendance/route.ts
//
// W46 T2 — record per-member attendance for a group session.
//
// Body: { entries: [{ patient_id, attendance, late_arrival_minutes?, early_departure_minutes?, participation_note? }] }
// UPSERTs into ehr_group_participants on (group_session_id, patient_id).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ATTENDANCE = new Set(['attended', 'absent', 'late', 'left_early'])

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  const entries = Array.isArray(body?.entries) ? body.entries : null
  if (!entries) return NextResponse.json({ error: 'entries[] required' }, { status: 400 })

  // Verify group session belongs to this practice.
  const gs = await pool.query(
    `SELECT id FROM ehr_group_sessions WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [params.id, ctx.practiceId],
  )
  if (gs.rows.length === 0) {
    return NextResponse.json({ error: 'group_session_not_found' }, { status: 404 })
  }

  let updated = 0
  for (const e of entries) {
    const attendance = ATTENDANCE.has(e.attendance) ? e.attendance : null
    if (!e.patient_id || !attendance) continue
    await pool.query(
      `INSERT INTO ehr_group_participants
         (group_session_id, practice_id, patient_id,
          attendance, late_arrival_minutes, early_departure_minutes,
          participation_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (group_session_id, patient_id) DO UPDATE
         SET attendance              = EXCLUDED.attendance,
             late_arrival_minutes    = EXCLUDED.late_arrival_minutes,
             early_departure_minutes = EXCLUDED.early_departure_minutes,
             participation_note      = EXCLUDED.participation_note`,
      [
        params.id,
        ctx.practiceId,
        e.patient_id,
        attendance,
        Number.isFinite(Number(e.late_arrival_minutes)) ? Number(e.late_arrival_minutes) : null,
        Number.isFinite(Number(e.early_departure_minutes)) ? Number(e.early_departure_minutes) : null,
        e.participation_note ? String(e.participation_note).slice(0, 1000) : null,
      ],
    )
    updated++
  }

  await auditEhrAccess({
    ctx,
    action: 'group_session.attendance_recorded',
    resourceType: 'ehr_group_session',
    resourceId: params.id,
    details: { entries_count: updated },
  })

  return NextResponse.json({ ok: true, updated })
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT gp.id, gp.patient_id::text, gp.attendance,
            gp.late_arrival_minutes, gp.early_departure_minutes,
            gp.participation_note, gp.note_id::text,
            p.first_name, p.last_name
       FROM ehr_group_participants gp
       JOIN patients p ON p.id = gp.patient_id
      WHERE gp.group_session_id = $1 AND gp.practice_id = $2
      ORDER BY p.last_name NULLS LAST, p.first_name NULLS LAST`,
    [params.id, ctx.practiceId],
  )

  return NextResponse.json({ participants: rows })
}
