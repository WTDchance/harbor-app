// app/api/ehr/patients/[id]/reports/[reportId]/close/route.ts
//
// Wave 39 / Task 4 — close a filed report. Body may set outcome_notes.
// Closed reports are immutable.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; reportId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId, reportId } = await params

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const outcome = typeof body.outcome_notes === 'string' ? body.outcome_notes : null

  const { rows } = await pool.query(
    `UPDATE ehr_mandatory_reports
        SET status = 'closed',
            outcome_notes = COALESCE($1, outcome_notes)
      WHERE practice_id = $2
        AND patient_id  = $3
        AND id          = $4
        AND status      IN ('draft', 'filed')
      RETURNING *`,
    [outcome, ctx.practiceId, patientId, reportId],
  )

  if (rows.length === 0) {
    const cur = await pool.query(
      `SELECT status FROM ehr_mandatory_reports
        WHERE practice_id = $1 AND patient_id = $2 AND id = $3 LIMIT 1`,
      [ctx.practiceId, patientId, reportId],
    )
    if (cur.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json(
      {
        error: {
          code: 'already_closed',
          message: `Report is '${cur.rows[0].status}'.`,
          retryable: false,
        },
      },
      { status: 409 },
    )
  }

  await auditEhrAccess({
    ctx,
    action: 'mandatory_report.closed',
    resourceType: 'ehr_mandatory_report',
    resourceId: reportId,
    details: { patient_id: patientId },
  })

  return NextResponse.json({ report: rows[0] })
}
