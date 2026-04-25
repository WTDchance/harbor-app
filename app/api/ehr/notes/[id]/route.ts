// Harbor EHR — read, update, delete a single progress note.
// Signed notes are immutable; PATCH on a signed note returns 409. Only
// drafts can be hard-deleted; signed/amended notes stay for audit.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UPDATABLE_FIELDS = [
  'title', 'note_format', 'subjective', 'objective', 'assessment', 'plan',
  'body', 'appointment_id', 'therapist_id', 'cpt_codes', 'icd10_codes',
] as const
const ARRAY_FIELDS = new Set(['cpt_codes', 'icd10_codes'])

async function loadNote(noteId: string, practiceId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM ehr_progress_notes WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [noteId, practiceId],
  )
  return rows[0] ?? null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const note = await loadNote(id, ctx.practiceId!)
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditEhrAccess({ ctx, action: 'note.view', resourceId: id })
  return NextResponse.json({ note })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const existing = await loadNote(id, ctx.practiceId!)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status === 'signed' || existing.status === 'amended') {
    return NextResponse.json(
      { error: 'Signed notes are immutable. Create an amendment instead.' },
      { status: 409 },
    )
  }

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const sets: string[] = []
  const args: unknown[] = []
  for (const k of UPDATABLE_FIELDS) {
    if (!(k in body)) continue
    args.push(ARRAY_FIELDS.has(k) ? (Array.isArray(body[k]) ? body[k] : []) : body[k])
    sets.push(`${k} = $${args.length}${ARRAY_FIELDS.has(k) ? '::text[]' : ''}`)
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 })
  }
  sets.push(`updated_at = NOW()`)
  args.push(id, ctx.practiceId)

  const { rows } = await pool.query(
    `UPDATE ehr_progress_notes
        SET ${sets.join(', ')}
      WHERE id = $${args.length - 1} AND practice_id = $${args.length}
    RETURNING *`,
    args,
  )

  await auditEhrAccess({
    ctx,
    action: 'note.update',
    resourceId: id,
    details: { fields: sets.slice(0, -1).map(s => s.split(' = ')[0]) },
  })
  return NextResponse.json({ note: rows[0] })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const existing = await loadNote(id, ctx.practiceId!)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status !== 'draft') {
    return NextResponse.json(
      { error: 'Only draft notes can be deleted. Signed notes stay for audit.' },
      { status: 409 },
    )
  }

  await pool.query(
    `DELETE FROM ehr_progress_notes WHERE id = $1 AND practice_id = $2`,
    [id, ctx.practiceId],
  )
  await auditEhrAccess({ ctx, action: 'note.delete', resourceId: id })
  return NextResponse.json({ success: true })
}
