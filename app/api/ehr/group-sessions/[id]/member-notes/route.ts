// app/api/ehr/group-sessions/[id]/member-notes/route.ts
//
// W46 T2 — per-member observations for a group session. Reuses the
// W41 ehr_progress_note_patients table:
//   * The shared session note is a single ehr_progress_notes row
//     with group_session_id pointing at this session.
//   * Per-member observations are ehr_progress_note_patients rows
//     keyed by (note_id, patient_id).
//
// POST body: { note_id, patient_id, individual_note_section }
// On first call for a given group, the caller may not have a note_id
// yet — the route accepts note_id=null and creates a draft progress
// note bound to this group_session_id, then returns the new id.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const patientId = String(body.patient_id || '')
  if (!patientId) return NextResponse.json({ error: 'patient_id required' }, { status: 400 })

  // Verify group session.
  const gs = await pool.query(
    `SELECT id FROM ehr_group_sessions WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [params.id, ctx.practiceId],
  )
  if (gs.rows.length === 0) {
    return NextResponse.json({ error: 'group_session_not_found' }, { status: 404 })
  }

  // Resolve or create the shared session note.
  let noteId: string | null = body.note_id ? String(body.note_id) : null
  if (!noteId) {
    const existing = await pool.query(
      `SELECT id FROM ehr_progress_notes
        WHERE practice_id = $1 AND group_session_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [ctx.practiceId, params.id],
    )
    if (existing.rows[0]) {
      noteId = existing.rows[0].id
    } else {
      const ins = await pool.query(
        `INSERT INTO ehr_progress_notes
           (practice_id, patient_id, group_session_id, title,
            note_format, status, created_by)
         VALUES ($1, $2, $3, $4, 'soap', 'draft', $5)
         RETURNING id`,
        [ctx.practiceId, patientId, params.id, 'Group session note', ctx.userId],
      )
      noteId = ins.rows[0].id
    }
  }

  const section = body.individual_note_section ? String(body.individual_note_section).slice(0, 4000) : null

  await pool.query(
    `INSERT INTO ehr_progress_note_patients
       (note_id, practice_id, patient_id, individual_note_section)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (note_id, patient_id) DO UPDATE
       SET individual_note_section = EXCLUDED.individual_note_section`,
    [noteId, ctx.practiceId, patientId, section],
  )

  await auditEhrAccess({
    ctx,
    action: 'group_session.member_note_added',
    resourceType: 'ehr_progress_note_patients',
    resourceId: noteId!,
    details: { note_id: noteId, has_section: !!section },
  })

  return NextResponse.json({ note_id: noteId, ok: true })
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const noteRow = await pool.query(
    `SELECT id::text FROM ehr_progress_notes
      WHERE practice_id = $1 AND group_session_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [ctx.practiceId, params.id],
  )
  const noteId = noteRow.rows[0]?.id || null

  if (!noteId) return NextResponse.json({ note_id: null, members: [] })

  const { rows } = await pool.query(
    `SELECT pnp.id, pnp.patient_id::text, pnp.individual_note_section,
            pnp.updated_at,
            p.first_name, p.last_name
       FROM ehr_progress_note_patients pnp
       JOIN patients p ON p.id = pnp.patient_id
      WHERE pnp.practice_id = $1 AND pnp.note_id = $2
      ORDER BY p.last_name NULLS LAST, p.first_name NULLS LAST`,
    [ctx.practiceId, noteId],
  )

  return NextResponse.json({ note_id: noteId, members: rows })
}
