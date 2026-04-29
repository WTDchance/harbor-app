// app/api/ehr/patients/[id]/eligibility-check/route.ts
//
// Launch-blocker fix #5 -- manual "Check coverage now" trigger.
//
// lib/aws/stedi/eligibility.ts already runs real 270/271 round-trips,
// but only the cron (/api/cron/eligibility-precheck) and the
// records-keyed /api/insurance/verify consumed it. There was no patient-
// keyed manual trigger reachable from the EHR insurance dashboard, so a
// practice owner who wanted "what's the copay right now?" had to wait
// for the next batch run.
//
// This route loads the patient's most recent insurance_records row,
// runs runAndPersistEligibilityCheck synchronously (5-15s typical, the
// caller shows a loading state), and returns the persisted result.
//
// HIPAA: requires an EHR session. Audited as billing.charge.list (the
// closest existing audit action; Stedi calls cost real money so we want
// a paper trail). severity: 'info' per spec.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { runAndPersistEligibilityCheck } from '@/lib/aws/stedi/eligibility'
import { checkAiRateLimit } from '@/lib/aws/ehr/draft-rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) {
    return NextResponse.json({ error: 'no_practice' }, { status: 403 })
  }
  const { id: patientId } = await params

  // Daily Stedi cap -- shared with /api/insurance/verify so a runaway UI
  // can't blow through the budget twice.
  const cap = await checkAiRateLimit(ctx.practiceId, 'eligibility.%')
  if (!cap.allowed) {
    return NextResponse.json(
      {
        error: 'rate_limited',
        message:
          'Daily eligibility-check limit reached for this practice. Resets at midnight Pacific.',
        cap: cap.cap,
        used: cap.used,
      },
      { status: 429 },
    )
  }

  // Allow the caller to target a specific insurance record; otherwise
  // default to the patient's most recent one.
  const body = await req.json().catch(() => ({} as any))
  const explicitRecordId: string | null = body?.insurance_record_id
    ? String(body.insurance_record_id)
    : null

  // Patient + insurance lookup (single round trip).
  const { rows: pRows } = await pool.query(
    `SELECT p.id AS patient_id,
            COALESCE(NULLIF(TRIM(p.first_name || ' ' || p.last_name), ''), p.email) AS patient_name,
            p.date_of_birth AS patient_dob,
            p.phone AS patient_phone,
            ir.id AS insurance_record_id,
            ir.insurance_company,
            ir.member_id,
            ir.group_number,
            ir.subscriber_name,
            ir.subscriber_dob,
            ir.payer_id_override
       FROM patients p
       LEFT JOIN insurance_records ir
              ON ir.patient_id = p.id AND ir.practice_id = p.practice_id
                 AND ($3::uuid IS NULL OR ir.id = $3)
      WHERE p.id = $1 AND p.practice_id = $2
      ORDER BY ir.created_at DESC NULLS LAST
      LIMIT 1`,
    [patientId, ctx.practiceId, explicitRecordId],
  ).catch((err: Error) => {
    console.error('[eligibility-check] patient lookup failed', err.message)
    return { rows: [] as any[] }
  })
  const row = pRows[0]
  if (!row) return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
  if (!row.insurance_record_id) {
    return NextResponse.json(
      { error: 'no_insurance_record', message: 'Patient has no insurance record on file.' },
      { status: 422 },
    )
  }

  const { rows: practiceRows } = await pool.query(
    `SELECT id, name, npi FROM practices WHERE id = $1 LIMIT 1`,
    [ctx.practiceId],
  )
  const practice = practiceRows[0]
  if (!practice) {
    return NextResponse.json({ error: 'practice_not_found' }, { status: 404 })
  }

  const result = await runAndPersistEligibilityCheck({
    insuranceRecordId: row.insurance_record_id,
    practice: { id: practice.id, name: practice.name ?? null, npi: practice.npi ?? null },
    patient: {
      name: row.patient_name ?? '',
      dob: row.patient_dob ? new Date(row.patient_dob).toISOString().slice(0, 10) : null,
      phone: row.patient_phone ?? null,
    },
    insurance: {
      company: row.insurance_company ?? null,
      memberId: row.member_id ?? null,
      groupNumber: row.group_number ?? null,
      payerIdOverride: row.payer_id_override ?? null,
    },
    subscriber: {
      name: row.subscriber_name ?? null,
      dob: row.subscriber_dob ? new Date(row.subscriber_dob).toISOString().slice(0, 10) : null,
    },
    triggerSource: 'manual',
  })

  await auditEhrAccess({
    ctx,
    action: 'billing.charge.list',
    resourceType: 'eligibility_check',
    resourceId: result.eligibilityCheckId,
    details: {
      kind: 'manual_eligibility_check',
      patient_id: patientId,
      insurance_record_id: row.insurance_record_id,
      status: result.status,
      is_active: result.isActive,
      copay_cents: result.copayAmount,
      deductible_total_cents: result.deductibleTotal,
      deductible_met_cents: result.deductibleMet,
      error_kind: result.errorKind,
    },
    severity: 'info',
  })

  return NextResponse.json({ result })
}
