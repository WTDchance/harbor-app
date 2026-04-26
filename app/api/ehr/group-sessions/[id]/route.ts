// app/api/ehr/group-sessions/[id]/route.ts
//
// Wave 22 (AWS port). Full session detail with participants. POST
// upserts a participant (attendance + participation_note).

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const { rows: sessRows } = await pool.query(
    `SELECT * FROM ehr_group_sessions WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, ctx.practiceId],
  )
  const session = sessRows[0]
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { rows: participants } = await pool.query(
    `SELECT id, patient_id, attendance, participation_note, note_id
       FROM ehr_group_participants
      WHERE group_session_id = $1 AND practice_id = $2`,
    [id, ctx.practiceId],
  )

  const patientIds = participants.map((p: any) => p.patient_id)
  let patientMap = new Map<string, { id: string; first_name: string; last_name: string }>()
  if (patientIds.length > 0) {
    const { rows: pat } = await pool.query<{ id: string; first_name: string; last_name: string }>(
      `SELECT id, first_name, last_name FROM patients
        WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [patientIds],
    )
    for (const p of pat) patientMap.set(p.id, p)
  }
  const enriched = participants.map((p: any) => ({
    ...p,
    patient: patientMap.get(p.patient_id) ?? null,
  }))

  return NextResponse.json({ session, participants: enriched })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const body = await req.json().catch(() => null)
  if (!body?.patient_id) return NextResponse.json({ error: 'patient_id required' }, { status: 400 })

  const [sessRes, patRes] = await Promise.all([
    pool.query(`SELECT id FROM ehr_group_sessions WHERE id = $1 AND practice_id = $2 LIMIT 1`, [id, ctx.practiceId]),
    pool.query(
      `SELECT id FROM patients WHERE id = $1 AND practice_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [body.patient_id, ctx.practiceId],
    ),
  ])
  if (sessRes.rows.length === 0) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (patRes.rows.length === 0) return NextResponse.json({ error: 'Patient not in this practice' }, { status: 404 })

  try {
    const { rows } = await pool.query(
      `INSERT INTO ehr_group_participants
          (group_session_id, practice_id, patient_id, attendance, participation_note)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (group_session_id, patient_id) DO UPDATE
          SET attendance = EXCLUDED.attendance,
              participation_note = EXCLUDED.participation_note
        RETURNING *`,
      [id, ctx.practiceId, body.patient_id, body.attendance ?? 'attended', body.participation_note ?? null],
    )
    await auditEhrAccess({
      ctx,
      action: 'note.update',
      resourceType: 'ehr_group_session',
      resourceId: id,
      details: { kind: 'group_participant_set', patient_id: body.patient_id, attendance: rows[0].attendance },
    })
    return NextResponse.json({ participant: rows[0] })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
