// Supervisor cosign of a signed (or amended) note. Does NOT change
// status; stamps cosigned_at + cosigned_by + cosign_hash.
//
// SCHEMA GAP — surfaced in Wave 13 design surface. The legacy supervisor
// authority check pattern relied on therapists.auth_user_id, which does
// NOT exist on either the AWS canonical or the legacy migration. In
// production today the legacy route's authority check silently fails
// every time and only the admin-email override actually cosigns. This
// AWS port matches that production behavior bug-for-bug while flagging
// the gap.
//
// Proper supervisor relationship enforcement should land in a follow-up
// wave alongside one of:
//   (a) extend the therapists table with auth_user_id (or email) and
//       cross-reference the Cognito user
//   (b) require the caller to pass `as_therapist_id` in the body and
//       verify it belongs to ehr_supervision against the note's signed_by
//   (c) move cosign to a dedicated dashboard widget that resolves the
//       acting therapist server-side from the Cognito session + a stored
//       therapist_id mapping
//
// Until then: requireEhrApiSession + admin-email override only. Audit
// row records 'admin_override' so the audit trail is honest about why
// the cosign was permitted.

import { NextResponse, type NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function contentHash(note: Record<string, any>): string {
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

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const noteRes = await client.query(
      `SELECT * FROM ehr_progress_notes
        WHERE id = $1 AND practice_id = $2 LIMIT 1`,
      [id, ctx.practiceId],
    )
    const note = noteRes.rows[0]
    if (!note) {
      await client.query('ROLLBACK'); client.release()
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (!note.requires_cosign) {
      await client.query('ROLLBACK'); client.release()
      return NextResponse.json(
        { error: 'This note does not require co-sign' },
        { status: 409 },
      )
    }
    if (note.cosigned_at) {
      await client.query('ROLLBACK'); client.release()
      return NextResponse.json({ error: 'Already co-signed' }, { status: 409 })
    }
    if (note.status !== 'signed' && note.status !== 'amended') {
      await client.query('ROLLBACK'); client.release()
      return NextResponse.json(
        { error: 'Note must be signed before co-sign' },
        { status: 409 },
      )
    }

    // Authority gate. Wave 38 / TS9 introduced users.supervisor_user_id
    // so we can resolve the actual supervisor of the note's signing user.
    // Admin email retains override capability for ops support.
    const adminEmails = (process.env.ADMIN_EMAIL || 'chancewonser@gmail.com')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    const callerIsAdmin = adminEmails.includes(ctx.session.email.toLowerCase())

    // Resolve the supervisor relationship: who supervises the user that
    // signed the note? If that supervisor === ctx.user.id, the cosign is
    // authorized.
    let cosignAuthority: 'supervisor' | 'admin_override' | 'none' = 'none'
    if (note.signed_by) {
      const supRes = await client.query(
        `SELECT supervisor_user_id, requires_supervision
           FROM users WHERE id = $1 LIMIT 1`,
        [note.signed_by],
      )
      const sup = supRes.rows[0]
      if (sup && sup.supervisor_user_id && sup.supervisor_user_id === ctx.user.id) {
        cosignAuthority = 'supervisor'
      }
    }
    if (cosignAuthority === 'none' && callerIsAdmin) cosignAuthority = 'admin_override'

    if (cosignAuthority === 'none') {
      await client.query('ROLLBACK'); client.release()
      return NextResponse.json(
        {
          error: 'Not authorized to co-sign this note',
          hint: 'You must be the configured supervisor of the signing clinician (users.supervisor_user_id) to cosign this note.',
        },
        { status: 403 },
      )
    }

    const hash = contentHash(note)
    const cosignedAt = new Date().toISOString()
    const updateRes = await client.query(
      `UPDATE ehr_progress_notes
          SET cosigned_at = $1,
              cosigned_by = $2,
              cosign_hash = $3,
              cosign_status = 'cosigned',
              updated_at = NOW()
        WHERE id = $4 AND practice_id = $5 AND cosigned_at IS NULL
        RETURNING *`,
      [cosignedAt, ctx.user.id, hash, id, ctx.practiceId],
    )
    if (!updateRes.rows[0]) {
      // Lost the race to a concurrent cosign.
      await client.query('ROLLBACK'); client.release()
      return NextResponse.json(
        { error: 'Note was cosigned by another request. Reload to see current state.' },
        { status: 409 },
      )
    }
    const updated = updateRes.rows[0]

    await client.query('COMMIT')
    client.release()

    await auditEhrAccess({
      ctx,
      action: cosignAuthority === 'supervisor' ? 'note.supervisor_cosigned' : 'note.cosign',
      resourceId: id,
      details: {
        kind: 'cosign',
        signed_by: note.signed_by,
        hash,
        authority: cosignAuthority,
        supervisor_user_id: ctx.user.id,
        supervisor_name: ctx.user?.full_name ?? ctx.session?.email ?? null,
      },
    })

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
