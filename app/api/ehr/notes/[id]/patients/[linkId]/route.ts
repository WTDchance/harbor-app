// app/api/ehr/notes/[id]/patients/[linkId]/route.ts
//
// Wave 41 / T2 — update an attendee's individual note section, or
// remove them from the note.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: noteId, linkId } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || !('individual_note_section' in body)) {
    return NextResponse.json({ error: { code: 'invalid_request', message: 'individual_note_section required' } }, { status: 400 })
  }

  // Refuse to edit if the parent note is signed.
  const note = await pool.query(
    `SELECT status FROM ehr_progress_notes WHERE practice_id = $1 AND id = $2 LIMIT 1`,
    [ctx.practiceId, noteId],
  )
  if (note.rows.length === 0) return NextResponse.json({ error: 'Note not found' }, { status: 404 })
  if (note.rows[0].status === 'signed' || note.rows[0].status === 'amended') {
    return NextResponse.json(
      { error: { code: 'note_locked', message: 'Note is locked. Create an amendment instead.' } },
      { status: 409 },
    )
  }

  const section = body.individual_note_section == null ? null : String(body.individual_note_section)
  const { rows } = await pool.query(
    `UPDATE ehr_progress_note_patients
        SET individual_note_section = $1
      WHERE practice_id = $2 AND note_id = $3 AND id = $4
      RETURNING *`,
    [section, ctx.practiceId, noteId, linkId],
  )
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'note.patient.section_updated',
    resourceType: 'ehr_progress_note_patient',
    resourceId: linkId,
    details: { note_id: noteId, patient_id: rows[0].patient_id },
  })

  return NextResponse.json({ section: rows[0] })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: noteId, linkId } = await params

  const { rows } = await pool.query(
    `DELETE FROM ehr_progress_note_patients
      WHERE practice_id = $1 AND note_id = $2 AND id = $3
      RETURNING patient_id`,
    [ctx.practiceId, noteId, linkId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'note.patient.removed',
    resourceType: 'ehr_progress_note_patient',
    resourceId: linkId,
    details: { note_id: noteId, patient_id: rows[0].patient_id },
  })

  return NextResponse.json({ removed: true })
}
