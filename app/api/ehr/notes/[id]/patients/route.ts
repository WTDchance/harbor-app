// app/api/ehr/notes/[id]/patients/route.ts
//
// Wave 41 / T2 — per-patient sections on multi-patient progress
// notes. List + add. Each row carries an `individual_note_section`
// for therapist observations specific to that attendee while the
// parent note's body holds the shared session narrative.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: noteId } = await params

  const { rows } = await pool.query(
    `SELECT pnp.*,
            p.first_name, p.last_name
       FROM ehr_progress_note_patients pnp
       LEFT JOIN patients p ON p.id = pnp.patient_id
      WHERE pnp.practice_id = $1 AND pnp.note_id = $2
      ORDER BY p.last_name ASC`,
    [ctx.practiceId, noteId],
  )

  return NextResponse.json({ sections: rows })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: noteId } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const patientId = typeof body.patient_id === 'string' ? body.patient_id : ''
  if (!patientId) return NextResponse.json({ error: { code: 'invalid_request', message: 'patient_id required' } }, { status: 400 })

  const section = typeof body.individual_note_section === 'string' ? body.individual_note_section : null

  // Verify note belongs to this practice.
  const note = await pool.query(
    `SELECT id, status FROM ehr_progress_notes WHERE practice_id = $1 AND id = $2 LIMIT 1`,
    [ctx.practiceId, noteId],
  )
  if (note.rows.length === 0) return NextResponse.json({ error: 'Note not found' }, { status: 404 })
  if (note.rows[0].status === 'signed' || note.rows[0].status === 'amended') {
    return NextResponse.json(
      { error: { code: 'note_locked', message: 'Cannot add patients to a signed/amended note. Create an amendment instead.' } },
      { status: 409 },
    )
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO ehr_progress_note_patients
         (note_id, practice_id, patient_id, individual_note_section)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [noteId, ctx.practiceId, patientId, section],
    )

    await auditEhrAccess({
      ctx,
      action: 'note.patient.added',
      resourceType: 'ehr_progress_note_patient',
      resourceId: rows[0].id,
      details: { note_id: noteId, patient_id: patientId, has_section: !!section },
    })

    return NextResponse.json({ section: rows[0] }, { status: 201 })
  } catch (err: any) {
    if (err?.code === '23505') {
      return NextResponse.json(
        { error: { code: 'duplicate', message: 'Patient already on this note.' } },
        { status: 409 },
      )
    }
    throw err
  }
}
