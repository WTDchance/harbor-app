// Sign a progress note. Once signed, the note is immutable (subsequent
// PATCHes 409). Amendments sign into status='amended' so the lineage
// stays visible; first-time signatures sign into status='signed'.
//
// Hash algorithm: SHA-256 of the canonical content fields joined with
// the U+241E ('SYMBOL FOR RECORD SEPARATOR') control character. Lifted
// VERBATIM from the legacy implementation — any future change has to
// match what historical signed notes already hashed against.
//
// AUTO-CHARGE deferred: legacy calls createChargesForSignedNote on
// success when the practice has billing enabled. That helper is
// Supabase-coupled. On AWS, therapists create charges manually via
// /api/ehr/billing/charges POST (already ported). TODO(phase-4b):
// port createChargesForSignedNote to lib/aws/ehr/billing.

import { NextResponse, type NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function contentHash(note: Record<string, any>): string {
  // Stable field order — match legacy bit-for-bit.
  const parts = [
    note.title || '',
    note.note_format || '',
    note.subjective || '',
    note.objective || '',
    note.assessment || '',
    note.plan || '',
    note.body || '',
    (note.cpt_codes || []).join(','),
    (note.icd10_codes || []).join(','),
  ]
  return createHash('sha256').update(parts.join('␞')).digest('hex')
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  // Optimistic-lock pattern: load + UPDATE WHERE status='draft' inside a
  // transaction so two concurrent sign requests don't both write a hash.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const noteRes = await client.query(
      `SELECT * FROM ehr_progress_notes
        WHERE id = $1 AND practice_id = $2
        LIMIT 1`,
      [id, ctx.practiceId],
    )
    const note = noteRes.rows[0]
    if (!note) {
      await client.query('ROLLBACK')
      client.release()
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (note.status !== 'draft') {
      await client.query('ROLLBACK')
      client.release()
      return NextResponse.json(
        { error: `Cannot sign a note in status "${note.status}".` },
        { status: 409 },
      )
    }

    const hasStructured = note.subjective || note.objective || note.assessment || note.plan
    const hasBody = typeof note.body === 'string' && note.body.trim().length > 0
    if (!hasStructured && !hasBody) {
      await client.query('ROLLBACK')
      client.release()
      return NextResponse.json(
        { error: 'Cannot sign an empty note. Add content in at least one section.' },
        { status: 400 },
      )
    }

    const hash = contentHash(note)
    const nextStatus = note.amendment_of ? 'amended' : 'signed'
    const signedAt = new Date().toISOString()

    const updateRes = await client.query(
      `UPDATE ehr_progress_notes
          SET status = $1,
              signed_at = $2,
              signed_by = $3,
              signature_hash = $4,
              updated_at = NOW()
        WHERE id = $5 AND practice_id = $6 AND status = 'draft'
        RETURNING *`,
      [nextStatus, signedAt, ctx.user.id, hash, id, ctx.practiceId],
    )
    if (!updateRes.rows[0]) {
      // Lost the race to a concurrent sign — surface the current state.
      await client.query('ROLLBACK')
      client.release()
      return NextResponse.json(
        { error: 'Note was signed by another request. Reload to see the current state.' },
        { status: 409 },
      )
    }
    const updated = updateRes.rows[0]

    await client.query('COMMIT')
    client.release()

    await auditEhrAccess({
      ctx,
      action: 'note.sign',
      resourceId: id,
      details: {
        status: nextStatus,
        amendment_of: note.amendment_of ?? null,
        hash,
      },
    })

    // TODO(phase-4b): auto-create charges for the signed note when the
    // practice has billing enabled. Held back because lib/ehr/billing
    // (createChargesForSignedNote) is Supabase-coupled. Therapists can
    // create charges manually via /api/ehr/billing/charges POST in the
    // meantime.

    return NextResponse.json({ note: updated, success: true })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
    return NextResponse.json(
      { error: (err as Error).message || 'Internal server error' },
      { status: 500 },
    )
  }
}
