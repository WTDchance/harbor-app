// app/api/insurance/verify/route.ts
//
// Wave 24 (AWS port). Real-time Stedi 270/271 eligibility check.
// Called by the insurance dashboard "Verify" button.
//
// Auth: Cognito session via requireApiSession.
// Practice: getEffectivePracticeId (act-as cookie aware).
// Stedi lib: lib/aws/stedi/eligibility (mirrored in Wave 9). The
// X12 270 assembly is preserved bit-for-bit there — we just hand
// it the input and persist the response.
//
// Per-practice daily cap of 100 via checkAiRateLimit('eligibility.%')
// — Stedi 270s cost real money per call ($0.10–$0.25 each), and
// Lift wants to cap runaway bots / dashboard glitch loops the same
// way we cap AI spend.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { getEffectivePracticeId } from '@/lib/active-practice'
import { runAndPersistEligibilityCheck } from '@/lib/aws/stedi/eligibility'
import { knownPayerNames, resolvePayerIdWithDb } from '@/lib/aws/stedi/payers'
import { checkAiRateLimit } from '@/lib/aws/ehr/draft-rate-limit'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export async function POST(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx

  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) {
    return NextResponse.json(
      {
        error: {
          code: 'practice_not_found',
          message: 'No practice is associated with this user account.',
          retryable: false,
        },
        error_message: 'No practice is associated with this user account.',
      },
      { status: 404 },
    )
  }

  // Daily cap — eligibility checks cost real money.
  const cap = await checkAiRateLimit(practiceId, 'eligibility.%')
  if (!cap.allowed) {
    return NextResponse.json(
      {
        error: {
          code: 'rate_limited',
          message:
            "Daily eligibility-check limit reached for this practice. Resets at midnight Pacific.",
          retryable: false,
        },
        // Legacy fields preserved for older callers.
        error_code: 'rate_limited',
        error_message:
          "Daily eligibility-check limit reached for this practice. Resets at midnight Pacific.",
        cap: cap.cap,
        used: cap.used,
      },
      { status: 429 },
    )
  }

  const { rows: pRows } = await pool.query(
    `SELECT id, name, npi FROM practices WHERE id = $1 LIMIT 1`,
    [practiceId],
  )
  const practice = pRows[0]
  if (!practice) {
    return NextResponse.json(
      {
        error: {
          code: 'practice_not_found',
          message: 'Practice record could not be loaded.',
          retryable: false,
        },
        error_message: 'Practice record could not be loaded.',
      },
      { status: 404 },
    )
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: 'Request body could not be parsed as JSON.',
          retryable: false,
        },
        error_message: 'Request body could not be parsed as JSON.',
      },
      { status: 400 },
    )
  }
  const {
    record_id,
    patient_id,
    patient_name,
    patient_dob,
    patient_phone,
    insurance_company,
    member_id,
    group_number,
    subscriber_name,
    subscriber_dob,
    payer_id: payerIdOverride,
  } = body

  if (!insurance_company || !patient_name) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message:
            'Insurance carrier and patient name are required to run a verification.',
          retryable: false,
        },
        error_message:
          'Insurance carrier and patient name are required to run a verification.',
      },
      { status: 400 },
    )
  }

  // Fail fast on unknown payers so the dashboard surfaces a useful
  // message instead of writing a manual_pending row.
  if (!payerIdOverride) {
    const resolved = await resolvePayerIdWithDb(insurance_company, null)
    if (!resolved) {
      const msg = `We don't recognize the carrier "${insurance_company}". Check the spelling on the insurance card, or provide a payer ID manually.`
      return NextResponse.json(
        {
          error: {
            code: 'invalid_request',
            message: msg,
            retryable: false,
          },
          error_message: msg,
          known_payers: knownPayerNames(),
        },
        { status: 422 },
      )
    }
  }

  // Upsert insurance_records — reuse caller-supplied record_id when
  // provided (so "Verify again" doesn't fragment history).
  let insuranceRecordId: string | undefined = record_id
  if (!insuranceRecordId) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO insurance_records
            (practice_id, patient_id, patient_name, patient_dob,
             patient_phone, insurance_company, member_id, group_number,
             subscriber_name, subscriber_dob)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id`,
        [
          practice.id,
          patient_id || null,
          patient_name,
          patient_dob || null,
          patient_phone || null,
          insurance_company,
          member_id || null,
          group_number || null,
          subscriber_name || patient_name,
          subscriber_dob || patient_dob || null,
        ],
      )
      insuranceRecordId = rows[0].id
    } catch (err) {
      console.error('[verify] failed to insert insurance_records', err)
      return NextResponse.json(
        {
          error: {
            code: 'persistence_failed',
            message:
              "Couldn't save the insurance record before verifying. Try again in a moment.",
            retryable: true,
          },
          error_message:
            "Couldn't save the insurance record before verifying. Try again in a moment.",
        },
        { status: 502 },
      )
    }
  }

  const result = await runAndPersistEligibilityCheck({
    insuranceRecordId: insuranceRecordId!,
    practice: {
      id: practice.id,
      name: practice.name ?? null,
      npi: practice.npi ?? null,
    },
    patient: {
      name: patient_name,
      dob: patient_dob || null,
      phone: patient_phone || null,
    },
    insurance: {
      company: insurance_company,
      memberId: member_id || null,
      groupNumber: group_number || null,
      payerIdOverride: payerIdOverride || null,
    },
    subscriber: {
      name: subscriber_name || null,
      dob: subscriber_dob || null,
    },
    triggerSource: 'manual',
  })

  // Audit on every check (the rate-limit lib counts these rows).
  await auditEhrAccess({
    ctx,
    action: 'note.update',
    resourceType: 'eligibility_check',
    resourceId: result.eligibilityCheckId ?? insuranceRecordId,
    details: {
      kind: 'eligibility.manual',
      family: 'eligibility',
      insurance_record_id: insuranceRecordId,
      payer_company: insurance_company,
      result_status: result.status,
      cap_used: cap.used + 1,
    },
  })

  // Map structured errorKind → HTTP status per the Wave 39 contract.
  //   422 → client-data issue (member not found, invalid request, unknown payer)
  //   429 → rate limited (Stedi or our local cap, but the cap fires earlier)
  //   502 → upstream issue (Stedi or payer down, network error)
  //   200 → success branches AND coverage_inactive (a valid-but-bad answer)
  let httpStatus: number = 200
  if (result.status === 'error') {
    switch (result.errorKind) {
      case 'rate_limited': httpStatus = 429; break
      case 'payer_down':
      case 'network_error': httpStatus = 502; break
      case 'member_not_found':
      case 'invalid_request': httpStatus = 422; break
      default: httpStatus = 422; break
    }
  }

  const responseBody: Record<string, unknown> = {
    record_id: result.insuranceRecordId,
    status: result.status,
    insurance_company,
    member_id,
    is_active: result.isActive,
    mental_health_covered: result.mentalHealthCovered,
    copay_amount: result.copayAmount,
    coinsurance_percent: result.coinsurancePercent,
    deductible_total: result.deductibleTotal,
    deductible_met: result.deductibleMet,
    session_limit: result.sessionLimit,
    sessions_used: result.sessionsUsed,
    prior_auth_required: result.priorAuthRequired,
    plan_name: result.planName,
    coverage_start_date: result.coverageStartDate,
    coverage_end_date: result.coverageEndDate,
    error_message: result.errorMessage,
    eligibility_check_id: result.eligibilityCheckId,
  }
  // Only include the structured error envelope on actual error branches —
  // coverage_inactive is a successful response with bad news, not an error.
  if (result.status === 'error' && result.errorKind) {
    responseBody.error = {
      code: result.errorKind,
      message: result.errorMessage,
      retryable: result.retryable,
    }
  }
  return NextResponse.json(responseBody, { status: httpStatus })
}
