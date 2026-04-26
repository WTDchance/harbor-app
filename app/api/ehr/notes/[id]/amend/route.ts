// Create an amendment to a signed (or amended) note.
//
// The original note stays SIGNED + immutable. This route copies its
// content into a fresh DRAFT row with amendment_of pointing at the
// original. The therapist edits the draft and signs it via the regular
// /api/ehr/notes/[id]/sign route, which detects the amendment_of
// pointer and signs into status='amended' instead of 'signed'.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const origRes = await pool.query(
    `SELECT * FROM ehr_progress_notes
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, ctx.practiceId],
  )
  const original = origRes.rows[0]
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (original.status !== 'signed' && original.status !== 'amended') {
    return NextResponse.json(
      { error: 'Only signed notes can be amended. Edit drafts directly.' },
      { status: 409 },
    )
  }

  // Single-row insert — no transaction needed (no multi-table side effects).
  const ins = await pool.query(
    `INSERT INTO ehr_progress_notes (
       practice_id, patient_id, appointment_id, therapist_id,
       title, note_format,
       subjective, objective, assessment, plan, body,
       cpt_codes, icd10_codes,
       status, amendment_of
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6,
       $7, $8, $9, $10, $11,
       $12::text[], $13::text[],
       'draft', $14
     )
     RETURNING *`,
    [
      ctx.practiceId, original.patient_id, original.appointment_id, original.therapist_id,
      `Amendment to: ${original.title}`, original.note_format,
      original.subjective, original.objective, original.assessment,
      original.plan, original.body,
      original.cpt_codes ?? [], original.icd10_codes ?? [],
      original.id,
    ],
  )
  const amendment = ins.rows[0]

  await auditEhrAccess({
    ctx,
    action: 'note.amend.create',
    resourceId: amendment.id,
    details: { amendment_of: original.id, title: amendment.title },
  })

  return NextResponse.json({ note: amendment }, { status: 201 })
}
