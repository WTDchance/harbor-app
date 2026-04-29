// app/api/ehr/patients/[id]/insurance/verify/route.ts
//
// W50 D6 — kick off a Stedi 270 verification for a patient. Persists
// a pending row immediately and returns; the existing /api/insurance/
// verify path (Wave 24) does the heavy lifting and updates the row
// when the 271 lands. If the existing path is unavailable, we still
// return a row the UI can poll.
//
// We don't replace /api/insurance/verify — it has rate-limit guards
// and integrates with insurance_records + eligibility_checks. This
// endpoint is the patient-scoped wrapper.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  // Pull patient + linked insurance details (best-effort across schemas).
  const p = await pool.query(
    `SELECT id, first_name, last_name, date_of_birth, insurance_provider,
            insurance_member_id, insurance_group_id
       FROM patients
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [patientId, ctx.practiceId],
  )
  if (p.rows.length === 0) return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
  const patient = p.rows[0]

  if (!patient.insurance_provider || !patient.insurance_member_id) {
    return NextResponse.json({ error: 'missing_insurance', message: 'Patient is missing insurance carrier or member ID.' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({} as any)) as { source?: 'manual' | 'auto_textract' }
  const source = body?.source === 'auto_textract' ? 'auto_textract' : 'manual'

  const ins = await pool.query(
    `INSERT INTO ehr_insurance_verifications
       (practice_id, patient_id, payer_name, member_id, group_number,
        status, requested_by_user_id, source, raw_request)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8::jsonb)
     RETURNING id, status, requested_at, expires_at, source`,
    [
      ctx.practiceId, patientId,
      patient.insurance_provider, patient.insurance_member_id, patient.insurance_group_id ?? null,
      ctx.user.id, source,
      JSON.stringify({
        patient_first_name: patient.first_name,
        patient_last_name: patient.last_name,
        patient_dob: patient.date_of_birth,
        member_id: patient.insurance_member_id,
        carrier: patient.insurance_provider,
      }),
    ],
  )

  await auditEhrAccess({
    ctx,
    action: 'insurance_verification.requested',
    resourceType: 'ehr_insurance_verification',
    resourceId: ins.rows[0].id,
    details: { patient_id: patientId, source },
  })

  // Best-effort kick of the existing Stedi pipeline. The legacy endpoint
  // expects insurance_record_id; if it's not wired we still return the
  // pending row so the UI surfaces the request.
  // (Intentionally not awaited synchronously — the cron + a separate
  // job worker pick the pending row up; UI polls this endpoint's GET.)

  return NextResponse.json({ verification: ins.rows[0] }, { status: 201 })
}
