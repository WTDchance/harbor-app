// Patient portal — patient marks homework complete / skipped / reopens.
//
// PATCH body: { action: 'complete' | 'skip' | 'reopen', completion_note? }
//
// Ownership is enforced by the practice_id + patient_id match on the
// existing row. completion_note is capped at 500 chars.

import { NextResponse, type NextRequest } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Action = 'complete' | 'skip' | 'reopen'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const { id } = await params
  const body = await req.json().catch(() => null) as any
  const action = body?.action as Action | undefined
  const note = typeof body?.completion_note === 'string'
    ? body.completion_note.slice(0, 500)
    : null

  if (action !== 'complete' && action !== 'skip' && action !== 'reopen') {
    return NextResponse.json(
      { error: 'action must be complete | skip | reopen' },
      { status: 400 },
    )
  }

  // Ownership check — must belong to the signed-in patient + practice.
  const own = await pool.query(
    `SELECT id FROM ehr_homework
      WHERE id = $1 AND practice_id = $2 AND patient_id = $3
      LIMIT 1`,
    [id, sess.practiceId, sess.patientId],
  ).catch(() => ({ rows: [] as any[] }))
  if (!own.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const nowIso = new Date().toISOString()
  let updateSql: string
  let args: unknown[]
  if (action === 'complete') {
    updateSql = `UPDATE ehr_homework
                    SET status = 'completed', completed_at = $1,
                        completion_note = $2, updated_at = NOW()
                  WHERE id = $3 RETURNING *`
    args = [nowIso, note, id]
  } else if (action === 'skip') {
    updateSql = `UPDATE ehr_homework
                    SET status = 'skipped', completed_at = $1,
                        completion_note = $2, updated_at = NOW()
                  WHERE id = $3 RETURNING *`
    args = [nowIso, note, id]
  } else {
    updateSql = `UPDATE ehr_homework
                    SET status = 'assigned', completed_at = NULL,
                        completion_note = NULL, updated_at = NOW()
                  WHERE id = $1 RETURNING *`
    args = [id]
  }

  const { rows } = await pool.query(updateSql, args)
  const homework = rows[0]

  auditPortalAccess({
    session: sess,
    action: 'portal.homework.update',
    resourceType: 'ehr_homework',
    resourceId: id,
    details: { homework_action: action, has_note: !!note },
  }).catch(() => {})

  return NextResponse.json({ homework })
}
