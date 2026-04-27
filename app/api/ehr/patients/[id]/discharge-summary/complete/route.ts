// app/api/ehr/patients/[id]/discharge-summary/complete/route.ts
//
// Wave 39 / Task 2 — mark a draft discharge summary as completed AND
// flip patients.patient_status = 'discharged' atomically. We use a
// transaction so partial completion is impossible.
//
// Re-activation (status back to 'active') is a future endpoint —
// the brief mentions it; this PR does not include it.

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
  const { id: patientId } = await params

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const upd = await client.query(
      `UPDATE ehr_discharge_summaries
          SET status = 'completed', completed_at = NOW()
        WHERE practice_id = $1 AND patient_id = $2 AND status = 'draft'
        RETURNING *`,
      [ctx.practiceId, patientId],
    )
    if (upd.rows.length === 0) {
      await client.query('ROLLBACK')

      // Decide between "no draft" and "already completed".
      const cur = await client.query(
        `SELECT status FROM ehr_discharge_summaries
          WHERE practice_id = $1 AND patient_id = $2 LIMIT 1`,
        [ctx.practiceId, patientId],
      )
      if (cur.rows.length === 0) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      return NextResponse.json(
        {
          error: {
            code: 'already_completed',
            message: `Discharge summary status is '${cur.rows[0].status}'.`,
            retryable: false,
          },
        },
        { status: 409 },
      )
    }

    await client.query(
      `UPDATE patients SET patient_status = 'discharged', updated_at = NOW()
        WHERE id = $1 AND practice_id = $2`,
      [patientId, ctx.practiceId],
    )

    await client.query('COMMIT')

    await auditEhrAccess({
      ctx,
      action: 'discharge_summary.completed',
      resourceType: 'ehr_discharge_summary',
      resourceId: upd.rows[0].id,
      details: {
        patient_id: patientId,
        discharge_reason: upd.rows[0].discharge_reason,
        discharged_at: upd.rows[0].discharged_at,
      },
    })

    return NextResponse.json({ summary: upd.rows[0] })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
