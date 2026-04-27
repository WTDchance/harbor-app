// app/api/ehr/patients/[id]/reports/[reportId]/file/route.ts
//
// Wave 39 / Task 4 — transition a mandatory report from draft -> filed.
// Body may include agency_contacted / agency_phone / report_filed_at /
// report_reference_number to capture filing details in one call.

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
  const agency = typeof body.agency_contacted === 'string' ? body.agency_contacted : null
  const agencyPhone = typeof body.agency_phone === 'string' ? body.agency_phone : null
  const refNumber = typeof body.report_reference_number === 'string' ? body.report_reference_number : null
  const filedAt = typeof body.report_filed_at === 'string' ? body.report_filed_at : new Date().toISOString()

  const { rows } = await pool.query(
    `UPDATE ehr_mandatory_reports
        SET status = 'filed',
            agency_contacted = COALESCE($1, agency_contacted),
            agency_phone     = COALESCE($2, agency_phone),
            report_reference_number = COALESCE($3, report_reference_number),
            report_filed_at  = $4
      WHERE practice_id = $5
        AND patient_id  = $6
        AND id          = $7
        AND status      = 'draft'
      RETURNING *`,
    [agency, agencyPhone, refNumber, filedAt, ctx.practiceId, patientId, reportId],
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
          code: 'wrong_status',
          message: `Report is '${cur.rows[0].status}'. Only drafts can transition to filed.`,
          retryable: false,
        },
      },
      { status: 409 },
    )
  }

  await auditEhrAccess({
    ctx,
    action: 'mandatory_report.filed',
    resourceType: 'ehr_mandatory_report',
    resourceId: reportId,
    details: {
      patient_id: patientId,
      // Agency name + reference number are useful for forensic trail;
      // they are NOT PHI (they describe a CPS/APS filing, not patient data).
      agency_contacted: rows[0].agency_contacted,
      report_reference_number: rows[0].report_reference_number,
    },
  })

  return NextResponse.json({ report: rows[0] })
}
