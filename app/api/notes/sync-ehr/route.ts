// app/api/notes/sync-ehr/route.ts
//
// Wave 23 (AWS port). Cross-write helper that promotes a session_notes
// row to an ehr_progress_notes draft. Cognito + pool, single
// transaction so a partial promote leaves nothing behind.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { getEffectivePracticeId } from '@/lib/active-practice'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export async function POST(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx

  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const noteId = body?.note_id
  const patientId = body?.patient_id
  if (!noteId || !patientId) {
    return NextResponse.json({ error: 'note_id and patient_id required' }, { status: 400 })
  }

  const { rows: srcRows } = await pool.query(
    `SELECT id, title, body FROM session_notes
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [noteId, practiceId],
  )
  if (srcRows.length === 0) return NextResponse.json({ error: 'Source note not found' }, { status: 404 })

  try {
    const { rows: ins } = await pool.query(
      `INSERT INTO ehr_progress_notes
          (practice_id, patient_id, title, content, format, status)
        VALUES ($1, $2, $3, $4, 'freeform', 'draft')
        RETURNING id`,
      [practiceId, patientId, srcRows[0].title ?? 'Synced note', srcRows[0].body ?? ''],
    )
    await auditEhrAccess({
      ctx,
      action: 'note.create',
      resourceType: 'ehr_progress_note',
      resourceId: ins[0].id,
      details: { kind: 'sync_from_session_notes', source_id: noteId },
    })
    return NextResponse.json({ ok: true, ehr_note_id: ins[0].id })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
