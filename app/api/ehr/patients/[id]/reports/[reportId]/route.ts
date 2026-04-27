// app/api/ehr/patients/[id]/reports/[reportId]/route.ts
//
// Wave 39 / Task 4 — fetch + update one mandatory report.
// PATCH only allowed while status='draft' OR 'filed'; once 'closed',
// rows are immutable.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UPDATABLE_FIELDS = [
  'report_type', 'disclosure_date', 'assessment_notes',
  'agency_contacted', 'agency_phone',
  'report_filed_at', 'report_reference_number',
  'intended_target_warned', 'target_warning_method',
  'outcome_notes',
] as const

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; reportId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId, reportId } = await params

  const { rows } = await pool.query(
    `SELECT r.*,
            COALESCE(u.full_name, u.email) AS reporter_name,
            COALESCE(s.full_name, s.email) AS supervisor_name
       FROM ehr_mandatory_reports r
       LEFT JOIN users u ON u.id = r.reporter_user_id
       LEFT JOIN users s ON s.id = r.supervisor_user_id
      WHERE r.practice_id = $1 AND r.patient_id = $2 AND r.id = $3
      LIMIT 1`,
    [ctx.practiceId, patientId, reportId],
  )
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await auditEhrAccess({
    ctx,
    action: 'mandatory_report.viewed',
    resourceType: 'ehr_mandatory_report',
    resourceId: reportId,
    details: { patient_id: patientId },
  })

  return NextResponse.json({ report: rows[0] })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; reportId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId, reportId } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const cur = await pool.query(
    `SELECT status FROM ehr_mandatory_reports
      WHERE practice_id = $1 AND patient_id = $2 AND id = $3 LIMIT 1`,
    [ctx.practiceId, patientId, reportId],
  )
  if (cur.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (cur.rows[0].status === 'closed') {
    return NextResponse.json(
      {
        error: {
          code: 'not_editable',
          message: 'Closed mandatory reports are immutable.',
          retryable: false,
        },
      },
      { status: 409 },
    )
  }

  const sets: string[] = []
  const args: unknown[] = []
  for (const k of UPDATABLE_FIELDS) {
    if (k in body) {
      const v = body[k]
      args.push(v == null ? null : (typeof v === 'boolean' ? v : String(v)))
      sets.push(`${k} = $${args.length}`)
    }
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }
  args.push(ctx.practiceId, patientId, reportId)
  const { rows } = await pool.query(
    `UPDATE ehr_mandatory_reports
        SET ${sets.join(', ')}
      WHERE practice_id = $${args.length - 2}
        AND patient_id  = $${args.length - 1}
        AND id          = $${args.length}
      RETURNING *`,
    args,
  )

  await auditEhrAccess({
    ctx,
    action: 'mandatory_report.updated',
    resourceType: 'ehr_mandatory_report',
    resourceId: reportId,
    details: {
      patient_id: patientId,
      fields_changed: sets.map((s) => s.split(' ')[0]),
    },
  })

  return NextResponse.json({ report: rows[0] })
}
