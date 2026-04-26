// app/api/patients/[id]/billing-mode/route.ts
//
// Wave 23 (AWS port). Switch a patient's billing_mode with the same
// audit + insurance_records side-effects as legacy:
// - Switching to self_pay archives any active insurance_records
// - Switching to insurance reactivates the most recent archived
//   insurance_record for the patient (if one exists)
// - Switching FROM insurance TO self_pay requires a non-empty reason

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { getEffectivePracticeId } from '@/lib/active-practice'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

const ALLOWED_MODES = ['pending', 'insurance', 'self_pay', 'sliding_scale'] as const
type BillingMode = (typeof ALLOWED_MODES)[number]

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const newMode = body?.billing_mode as BillingMode | undefined
  const reason: string | null =
    typeof body?.reason === 'string' && body.reason.trim() !== '' ? body.reason.trim() : null

  if (!newMode || !ALLOWED_MODES.includes(newMode)) {
    return NextResponse.json(
      { error: `Invalid billing_mode. Must be one of: ${ALLOWED_MODES.join(', ')}` },
      { status: 400 },
    )
  }

  const { rows: pRows } = await pool.query(
    `SELECT id, billing_mode FROM patients
      WHERE id = $1 AND practice_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [id, practiceId],
  )
  if (pRows.length === 0) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
  const oldMode = pRows[0].billing_mode as BillingMode | null

  if (oldMode === 'insurance' && newMode === 'self_pay' && !reason) {
    return NextResponse.json(
      { error: 'reason required when switching from insurance to self_pay' },
      { status: 400 },
    )
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `UPDATE patients SET billing_mode = $1 WHERE id = $2 AND practice_id = $3`,
      [newMode, id, practiceId],
    )

    if (newMode === 'self_pay') {
      // Archive any active insurance_records (best-effort).
      await client.query(
        `UPDATE insurance_records SET status = 'archived', archived_at = NOW()
          WHERE patient_id = $1 AND practice_id = $2 AND status = 'active'`,
        [id, practiceId],
      )
    } else if (newMode === 'insurance') {
      // Reactivate the most recent archived record if one exists.
      const { rows: latest } = await client.query(
        `SELECT id FROM insurance_records
          WHERE patient_id = $1 AND practice_id = $2 AND status = 'archived'
          ORDER BY archived_at DESC NULLS LAST LIMIT 1`,
        [id, practiceId],
      )
      if (latest[0]?.id) {
        await client.query(
          `UPDATE insurance_records SET status = 'active', archived_at = NULL
            WHERE id = $1`,
          [latest[0].id],
        )
      }
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  } finally {
    client.release()
  }

  await auditEhrAccess({
    ctx,
    action: 'note.update',
    resourceType: 'patient',
    resourceId: id,
    details: {
      kind: 'billing_mode_change',
      from: oldMode,
      to: newMode,
      reason,
    },
  })

  return NextResponse.json({ ok: true, billing_mode: newMode })
}
