// app/api/ehr/predictions/by-patient/[patientId]/route.ts
//
// W45 T6 — fetch all current predictions for a single patient, plus
// the no_show prediction for their next upcoming appointment if any.
// Used by the patient detail header.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { patientId: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  // Patient-level predictions (engagement_score, dropout_risk).
  const patientLevel = await pool.query(
    `SELECT id, prediction_kind, score::float, factors, model_version,
            computed_at, override_score::float, override_reason, override_at
       FROM ehr_patient_predictions_v2
      WHERE practice_id = $1 AND patient_id = $2
        AND appointment_id IS NULL`,
    [ctx.practiceId, params.patientId],
  )

  // Next upcoming appointment + its no_show prediction (if any).
  const upcomingNoShow = await pool.query(
    `SELECT pp.id, pp.prediction_kind, pp.score::float, pp.factors,
            pp.model_version, pp.computed_at,
            pp.override_score::float, pp.override_reason, pp.override_at,
            pp.appointment_id, a.scheduled_for::text
       FROM appointments a
       LEFT JOIN ehr_patient_predictions_v2 pp
         ON pp.appointment_id = a.id AND pp.prediction_kind = 'no_show'
      WHERE a.practice_id = $1 AND a.patient_id = $2
        AND a.status IN ('scheduled','confirmed')
        AND a.scheduled_for >= NOW()
      ORDER BY a.scheduled_for ASC
      LIMIT 1`,
    [ctx.practiceId, params.patientId],
  )

  await auditEhrAccess({
    ctx,
    action: 'prediction.viewed',
    resourceType: 'prediction',
    resourceId: params.patientId,
    details: {
      surface: 'patient_header',
      patient_level_count: patientLevel.rows.length,
      has_upcoming: upcomingNoShow.rows.length > 0,
    },
  })

  return NextResponse.json({
    patient_level: patientLevel.rows,
    upcoming_no_show: upcomingNoShow.rows[0] || null,
  })
}
