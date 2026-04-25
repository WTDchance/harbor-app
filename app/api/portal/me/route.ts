// Patient portal home — bundle the data the dashboard landing page needs in
// one round-trip: patient profile, practice, upcoming appointments, signed
// consents, active treatment plan.
//
// Aligned to the AWS canonical patients/appointments schema (insurance is
// columnar, scheduled_for is a single TIMESTAMPTZ).

import { NextResponse } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const yesterdayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [patient, practice, appts, consents, plan] = await Promise.all([
    pool.query(
      `SELECT id, first_name, last_name, preferred_name, email, phone,
              insurance_provider, insurance_member_id, insurance_group_id,
              insurance_verified_at
         FROM patients WHERE id = $1 LIMIT 1`,
      [sess.patientId],
    ),
    pool.query(
      `SELECT id, name, phone FROM practices WHERE id = $1 LIMIT 1`,
      [sess.practiceId],
    ),
    pool.query(
      `SELECT id, scheduled_for, duration_minutes, appointment_type, status
         FROM appointments
        WHERE practice_id = $1 AND patient_id = $2 AND scheduled_for >= $3
        ORDER BY scheduled_for ASC
        LIMIT 10`,
      [sess.practiceId, sess.patientId, yesterdayIso],
    ),
    pool
      .query(
        `SELECT id, consent_type, version, status, document_name, signed_at
           FROM ehr_consents
          WHERE practice_id = $1 AND patient_id = $2
          ORDER BY created_at DESC`,
        [sess.practiceId, sess.patientId],
      )
      .catch(() => ({ rows: [] as any[] })),
    pool
      .query(
        `SELECT id, title, presenting_problem, goals, frequency,
                start_date, review_date, status
           FROM ehr_treatment_plans
          WHERE practice_id = $1 AND patient_id = $2 AND status = 'active'
          LIMIT 1`,
        [sess.practiceId, sess.patientId],
      )
      .catch(() => ({ rows: [] as any[] })),
  ])

  const patientRow = patient.rows[0] ?? null
  const insurance = patientRow
    ? {
        provider: patientRow.insurance_provider ?? null,
        member_id: patientRow.insurance_member_id ?? null,
        group_id: patientRow.insurance_group_id ?? null,
        verified_at: patientRow.insurance_verified_at ?? null,
      }
    : null

  auditPortalAccess({ session: sess, action: 'portal.me.view' }).catch(() => {})

  return NextResponse.json({
    patient: patientRow
      ? {
          id: patientRow.id,
          first_name: patientRow.first_name,
          last_name: patientRow.last_name,
          preferred_name: patientRow.preferred_name,
          email: patientRow.email,
          phone: patientRow.phone,
          insurance,
        }
      : null,
    practice: practice.rows[0] ?? null,
    appointments: appts.rows,
    consents: consents.rows,
    active_treatment_plan: plan.rows[0] ?? null,
  })
}
