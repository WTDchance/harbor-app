// app/api/patients/[id]/route.ts
//
// Wave 23 (AWS port). Full patient profile by UUID. Cognito + pool.
// Returns the merged shape the dashboard expects:
//   patient + intake_status + intake_forms[] + call_logs[] +
//   appointments[] + crisis_alerts[] + tasks[] + outcome_trend +
//   communication_prefs + eligibility
//
// Schema swaps:
//   appointments.scheduled_for replaces scheduled_at
//   crisis_alerts.created_at replaces triggered_at
//   patients.insurance_provider replaces legacy 'insurance' column
//   communication_prefs read directly from sms_opt_outs /
//     email_opt_outs / call_opt_outs tables (Bucket-5 helper libs
//     skipped).

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { getEffectivePracticeId } from '@/lib/active-practice'

async function isOpt(table: string, practiceId: string, val: string | null): Promise<boolean> {
  if (!val) return false
  try {
    const col = table === 'email_opt_outs' ? 'email' : 'phone'
    const { rowCount } = await pool.query(
      `SELECT 1 FROM ${table} WHERE practice_id = $1 AND ${col} = $2 LIMIT 1`,
      [practiceId, val],
    )
    return (rowCount ?? 0) > 0
  } catch {
    return false
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

  const { rows: pRows } = await pool.query(
    `SELECT * FROM patients
      WHERE id = $1 AND practice_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [patientId, practiceId],
  )
  const patient = pRows[0]
  if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

  // Intake forms — direct patient_id link, then phone fallback for legacy.
  let intakeForms: any[] = []
  const directRes = await pool.query(
    `SELECT id, status, score, severity, answers, completed_at, created_at,
            link_token, form_type, sent_at, expires_at
       FROM intake_forms
      WHERE practice_id = $1 AND patient_id = $2
      ORDER BY created_at DESC`,
    [practiceId, patientId],
  )
  intakeForms = directRes.rows

  // Call logs (most-recent 20)
  const callsRes = await pool.query(
    `SELECT id, patient_phone, duration_seconds, summary,
            call_type, caller_name, intake_sent, intake_delivery_preference,
            intake_email, crisis_detected, created_at
       FROM call_logs
      WHERE practice_id = $1 AND patient_id = $2
      ORDER BY created_at DESC
      LIMIT 20`,
    [practiceId, patientId],
  )

  // Appointments
  const apptRes = await pool.query(
    `SELECT id, scheduled_for, duration_minutes, status, appointment_type,
            source, patient_name
       FROM appointments
      WHERE practice_id = $1 AND patient_id = $2
      ORDER BY scheduled_for DESC NULLS LAST
      LIMIT 20`,
    [practiceId, patientId],
  )

  // Crisis alerts (by phone, AWS canonical created_at column)
  const crisisRes = patient.phone
    ? await pool.query(
        `SELECT id, call_log_id, patient_phone, created_at AS triggered_at, sms_sent
           FROM crisis_alerts
          WHERE practice_id = $1 AND patient_phone = $2
          ORDER BY created_at DESC
          LIMIT 10`,
        [practiceId, patient.phone],
      )
    : { rows: [] as any[] }

  // Insurance + latest eligibility check
  const insRes = await pool.query(
    `SELECT id, insurance_company, member_id, group_number,
            subscriber_name, subscriber_dob, relationship_to_subscriber,
            last_verified_at, last_verification_status, next_verify_due,
            updated_at
       FROM insurance_records
      WHERE practice_id = $1 AND patient_id = $2
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1`,
    [practiceId, patientId],
  )
  const latestInsurance = insRes.rows[0] ?? null
  let latestCheck: any = null
  if (latestInsurance?.id) {
    const checks = await pool.query(
      `SELECT id, status, is_active, mental_health_covered, copay_amount,
              coinsurance_percent, deductible_total, deductible_met,
              session_limit, sessions_used, prior_auth_required,
              plan_name, coverage_start_date, coverage_end_date,
              payer_id, trigger_source, error_message, checked_at
         FROM eligibility_checks
        WHERE insurance_record_id = $1
        ORDER BY checked_at DESC NULLS LAST
        LIMIT 1`,
      [latestInsurance.id],
    )
    latestCheck = checks.rows[0] ?? null
  }

  const [smsOut, emailOut, callOut] = await Promise.all([
    isOpt('sms_opt_outs', practiceId, patient.phone),
    isOpt('email_opt_outs', practiceId, patient.email),
    isOpt('call_opt_outs', practiceId, patient.phone),
  ])

  const completedIntake = intakeForms.find((f) => f.status === 'completed')
  const pendingIntake = intakeForms.find(
    (f) => f.status === 'sent' || f.status === 'opened' || f.status === 'in_progress',
  )
  const intakeStatus = pendingIntake?.status ?? (completedIntake ? 'completed' : 'none')

  const outcomeTrend = intakeForms
    .filter((f) => f.status === 'completed' && f.completed_at)
    .map((f) => ({
      date: f.completed_at,
      score: f.score,
      severity: f.severity,
      form_type: f.form_type,
    }))
    .reverse()

  const insuranceProvider =
    patient.insurance_provider ?? patient.insurance ?? null

  return NextResponse.json({
    patient: {
      id: patient.id,
      first_name: patient.first_name,
      last_name: patient.last_name,
      phone: patient.phone,
      email: patient.email,
      date_of_birth: patient.date_of_birth,
      insurance_provider: insuranceProvider,
      insurance_member_id: patient.insurance_member_id ?? null,
      insurance_group_number: patient.insurance_group_id ?? patient.insurance_group_number ?? null,
      notes: patient.notes ?? null,
      created_at: patient.created_at,
      address: patient.address_line_1 ?? patient.address ?? null,
      city: patient.city ?? null,
      state: patient.state ?? null,
      postal_code: patient.postal_code ?? null,
      pronouns: patient.pronouns ?? null,
      emergency_contact_name: patient.emergency_contact_name ?? null,
      emergency_contact_phone: patient.emergency_contact_phone ?? null,
      referral_source: patient.referral_source ?? null,
      reason_for_seeking:
        Array.isArray(patient.presenting_concerns) && patient.presenting_concerns.length
          ? patient.presenting_concerns.join('; ')
          : patient.reason_for_seeking ?? null,
      telehealth_preference: patient.telehealth_preference ?? null,
      patient_status: patient.patient_status ?? null,
      intake_completed: patient.intake_completed ?? intakeStatus === 'completed',
      intake_completed_at: patient.intake_completed_at ?? completedIntake?.completed_at ?? null,
      billing_mode: patient.billing_mode ?? 'pending',
      billing_mode_changed_at: patient.billing_mode_changed_at ?? null,
      billing_mode_changed_reason: patient.billing_mode_changed_reason ?? null,
    },
    intake_status: intakeStatus,
    intake_forms: intakeForms,
    call_logs: callsRes.rows,
    appointments: apptRes.rows,
    crisis_alerts: crisisRes.rows,
    tasks: [], // Wave 23: legacy 'tasks' table is Bucket 5 (carrier-coupled)
    outcome_trend: outcomeTrend,
    communication_prefs: {
      sms_opted_out: smsOut,
      email_opted_out: emailOut,
      call_opted_out: callOut,
      phone: patient.phone,
      email: patient.email,
    },
    eligibility: latestInsurance
      ? {
          record_id: latestInsurance.id,
          insurance_company: latestInsurance.insurance_company,
          member_id: latestInsurance.member_id,
          group_number: latestInsurance.group_number,
          subscriber_name: latestInsurance.subscriber_name,
          subscriber_dob: latestInsurance.subscriber_dob,
          relationship_to_subscriber: latestInsurance.relationship_to_subscriber,
          last_verified_at: latestInsurance.last_verified_at,
          last_verification_status: latestInsurance.last_verification_status,
          next_verify_due: latestInsurance.next_verify_due,
          latest_check: latestCheck,
        }
      : null,
  })
}

const ALLOWED_PATCH = [
  'first_name', 'last_name', 'email', 'phone', 'date_of_birth',
  'insurance_provider', 'insurance_member_id', 'insurance_group_number',
  'notes', 'address_line_1', 'city', 'state', 'postal_code',
  'pronouns', 'emergency_contact_name', 'emergency_contact_phone',
  'referral_source', 'reason_for_seeking', 'telehealth_preference',
  // Wave 40 / P4 — SOGI/REL demographics. All optional, all
  // self-declared. NEVER fed into AI prompts or CDS.
  'race', 'ethnicity', 'primary_language',
  'sexual_orientation', 'gender_identity', 'pronouns_self_describe',
  // Wave 41 / T6 — sliding-fee tier assignment.
  'fee_tier',
] as const

// Columns that are TEXT[]; the loop below skips the val === ''
// empty-string-to-null coercion for these and accepts JS arrays as-is.
const ARRAY_FIELDS = new Set(['race', 'ethnicity'])
const REQUIRED_FIELDS = new Set(['first_name', 'last_name', 'phone'])

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))

  const sets: string[] = []
  const args: any[] = [id, practiceId]
  for (const field of ALLOWED_PATCH) {
    if (!(field in body)) continue
    const val = body[field]
    let final: unknown
    if (ARRAY_FIELDS.has(field)) {
      // Empty array means "user cleared the selection" -> store as NULL.
      final = Array.isArray(val) && val.length > 0 ? val : null
    } else {
      final = !REQUIRED_FIELDS.has(field) && val === '' ? null : val
    }
    args.push(final)
    sets.push(`${field} = $${args.length}`)
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }
  // Keep legacy `insurance` column in sync if present
  if ('insurance_provider' in body) {
    args.push(args[args.length - 1])
    sets.push(`insurance = $${args.length}`)
  }
  sets.push('updated_at = NOW()')

  try {
    const { rows } = await pool.query(
      `UPDATE patients SET ${sets.join(', ')}
        WHERE id = $1 AND practice_id = $2
        RETURNING *`,
      args,
    )
    if (rows.length === 0) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    return NextResponse.json({ patient: rows[0] })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
