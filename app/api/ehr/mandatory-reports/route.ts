// Mandatory reports — DCFS / APS / Tarasoff filings logged for the
// clinician's audit trail.
//
// GET → list (read path).
// POST → create (legal record). Held for the eyes-on review pass — same
// posture as portal/consents/[id]/sign POST. Mandatory-report rows are
// state-mandated documentation and should land alongside a deliberate
// audit-of-creation flow.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ reports: [] })

  const patientId = req.nextUrl.searchParams.get('patient_id')
  const conds: string[] = ['practice_id = $1']
  const args: unknown[] = [ctx.practiceId]
  if (patientId) { args.push(patientId); conds.push(`patient_id = $${args.length}`) }

  const { rows } = await pool
    .query(
      `SELECT id, patient_id, report_type, reported_to, reported_at,
              incident_date, summary, basis_for_report, follow_up,
              reference_number, status, created_at
         FROM ehr_mandatory_reports
        WHERE ${conds.join(' AND ')}
        ORDER BY created_at DESC LIMIT 200`,
      args,
    )
    .catch(() => ({ rows: [] as any[] }))

  return NextResponse.json({ reports: rows })
}

// TODO(eyes-on review): port POST. Logs a state-mandated report (DCFS,
// APS, Tarasoff). Audit row needs severity='warn' and the resourceId
// returned to the caller. Wants a co-deployed dashboard confirmation
// flow because the row is legal documentation.
export async function POST() {
  return NextResponse.json(
    { error: 'mandatory_report_create_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
