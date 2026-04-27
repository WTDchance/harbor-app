// app/api/ehr/patients/[id]/reports/route.ts
//
// Wave 39 / Task 4 — mandatory reports list + create.
// HIGH-SENSITIVITY: every read/write is auditable.
//
// On create: if the reporter has a supervisor_user_id, send a
// PHI-free heads-up email to the supervisor and stamp
// supervisor_notified_at + supervisor_user_id on the report row.
// We never auto-file or auto-notify external agencies — the
// clinician contacts the agency themselves and records what they did.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { sendEmail, buildMandatoryReportSupervisorEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_TYPES = new Set([
  'child_abuse',
  'elder_abuse',
  'adult_dependent_abuse',
  'tarasoff_warning',
  'danger_to_self',
  'other',
])

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const { rows } = await pool.query(
    `SELECT r.*,
            COALESCE(u.full_name, u.email) AS reporter_name,
            COALESCE(s.full_name, s.email) AS supervisor_name
       FROM ehr_mandatory_reports r
       LEFT JOIN users u ON u.id = r.reporter_user_id
       LEFT JOIN users s ON s.id = r.supervisor_user_id
      WHERE r.practice_id = $1 AND r.patient_id = $2
      ORDER BY r.created_at DESC
      LIMIT 50`,
    [ctx.practiceId, patientId],
  )

  await auditEhrAccess({
    ctx,
    action: 'mandatory_report.viewed',
    resourceType: 'ehr_mandatory_report_list',
    resourceId: patientId,
    details: { count: rows.length },
  })

  return NextResponse.json({ reports: rows })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const reportType = String(body.report_type ?? '')
  if (!VALID_TYPES.has(reportType)) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: `report_type must be one of ${[...VALID_TYPES].join(', ')}`,
          retryable: false,
        },
      },
      { status: 400 },
    )
  }

  const disclosureDate = typeof body.disclosure_date === 'string'
    ? body.disclosure_date
    : new Date().toISOString()
  const assessmentNotes = String(body.assessment_notes ?? '').trim()
  if (!assessmentNotes) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: 'assessment_notes is required',
          retryable: false,
        },
      },
      { status: 400 },
    )
  }

  // Pull reporter's supervisor for the heads-up email.
  const sup = await pool.query(
    `SELECT u.supervisor_user_id, u.full_name AS clinician_name, u.email AS clinician_email,
            s.email AS supervisor_email
       FROM users u
       LEFT JOIN users s ON s.id = u.supervisor_user_id
      WHERE u.id = $1
      LIMIT 1`,
    [ctx.user.id],
  ).catch(() => ({ rows: [] as any[] }))
  const supervisorUserId: string | null = sup.rows[0]?.supervisor_user_id ?? null
  const supervisorEmail: string | null = sup.rows[0]?.supervisor_email ?? null
  const clinicianName: string =
    sup.rows[0]?.clinician_name || sup.rows[0]?.clinician_email || ctx.session.email

  const ins = await pool.query(
    `INSERT INTO ehr_mandatory_reports
       (patient_id, practice_id, reporter_user_id,
        report_type, disclosure_date, assessment_notes,
        supervisor_user_id, supervisor_notified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      patientId, ctx.practiceId, ctx.user.id,
      reportType, disclosureDate, assessmentNotes,
      supervisorUserId,
      supervisorUserId && supervisorEmail ? new Date().toISOString() : null,
    ],
  )
  const report = ins.rows[0]

  // Best-effort supervisor heads-up. Email failure must NOT block
  // creation — the supervisor can still see the row in their inbox.
  if (supervisorUserId && supervisorEmail) {
    try {
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL || 'https://lab.harboroffice.ai'
      const reportUrl = `${appUrl.replace(/\/$/, '')}/dashboard/patients/${patientId}/reports/${report.id}`
      const { subject, html } = buildMandatoryReportSupervisorEmail({
        clinicianName,
        reportUrl,
      })
      await sendEmail({ to: supervisorEmail, subject, html })
    } catch (err) {
      console.error('[mandatory-report] supervisor email failed:', (err as Error).message)
    }
  }

  await auditEhrAccess({
    ctx,
    action: 'mandatory_report.created',
    resourceType: 'ehr_mandatory_report',
    resourceId: report.id,
    details: {
      patient_id: patientId,
      report_type: reportType,
      supervisor_notified: !!supervisorUserId && !!supervisorEmail,
    },
  })

  return NextResponse.json({ report }, { status: 201 })
}
