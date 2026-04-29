// W50 D6 — most recent verification for the patient detail header badge.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const { rows } = await pool.query(
    `SELECT id, payer_name, member_id, group_number, plan_name, status,
            parsed_summary, requested_at, completed_at, expires_at, error_message, source
       FROM ehr_insurance_verifications
      WHERE practice_id = $1 AND patient_id = $2
      ORDER BY requested_at DESC
      LIMIT 5`,
    [ctx.practiceId, patientId],
  )

  await auditEhrAccess({
    ctx,
    action: 'insurance_verification.list',
    resourceType: 'ehr_insurance_verification',
    details: { patient_id: patientId, count: rows.length },
  })

  return NextResponse.json({ verifications: rows, latest: rows[0] ?? null })
}
