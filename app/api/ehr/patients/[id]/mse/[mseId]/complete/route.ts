// app/api/ehr/patients/[id]/mse/[mseId]/complete/route.ts
//
// Wave 39 / Task 1 — mark a draft MSE as completed. After this,
// the row is immutable via PATCH; further edits require amendments
// (separate endpoint, not yet built).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; mseId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId, mseId } = await params

  const { rows } = await pool.query(
    `UPDATE ehr_mental_status_exams
        SET status = 'completed',
            completed_at = NOW()
      WHERE practice_id = $1
        AND patient_id  = $2
        AND id          = $3
        AND status      = 'draft'
      RETURNING *`,
    [ctx.practiceId, patientId, mseId],
  )

  if (rows.length === 0) {
    // Either not found, or already completed/amended.
    const cur = await pool.query(
      `SELECT status FROM ehr_mental_status_exams
        WHERE practice_id = $1 AND patient_id = $2 AND id = $3
        LIMIT 1`,
      [ctx.practiceId, patientId, mseId],
    )
    if (cur.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json(
      {
        error: {
          code: 'already_completed',
          message: `Exam status is '${cur.rows[0].status}'; only draft exams can be completed.`,
          retryable: false,
        },
      },
      { status: 409 },
    )
  }

  await auditEhrAccess({
    ctx,
    action: 'mental_status_exam.completed',
    resourceType: 'ehr_mental_status_exam',
    resourceId: mseId,
    details: { patient_id: patientId },
  })

  return NextResponse.json({ exam: rows[0] })
}
