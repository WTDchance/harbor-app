// W52 D5 — receptionist conversion funnel (call → completed PHQ-9 → 2nd appt).
import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const days = Math.min(365, Number(req.nextUrl.searchParams.get('days')) || 90)

  const r = await pool.query(
    `WITH calls AS (
       SELECT id, patient_id, created_at FROM call_logs
        WHERE practice_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'
     ),
     intake_complete AS (
       SELECT id FROM calls c
        WHERE EXISTS (
          SELECT 1 FROM ehr_call_signals s
           WHERE s.call_id = c.id
             AND s.signal_type IN ('name_candidate','dob_candidate','phone_confirmation')
           GROUP BY s.call_id HAVING COUNT(DISTINCT s.signal_type) >= 3
        )
     ),
     booked AS (
       SELECT DISTINCT a.call_log_id AS id FROM appointments a
        WHERE a.practice_id = $1 AND a.call_log_id IS NOT NULL
          AND a.created_at >= NOW() - INTERVAL '${days} days'
     ),
     attended AS (
       SELECT DISTINCT a.call_log_id AS id FROM appointments a
        WHERE a.practice_id = $1 AND a.call_log_id IS NOT NULL AND a.status = 'completed'
          AND a.scheduled_for >= NOW() - INTERVAL '${days} days'
     ),
     phq9_done AS (
       SELECT DISTINCT a.call_log_id AS id FROM appointments a
         JOIN assessment_administrations adm ON adm.patient_id = a.patient_id
        WHERE a.practice_id = $1 AND a.call_log_id IS NOT NULL
          AND adm.assessment_slug = 'phq-9' AND adm.status = 'completed'
          AND adm.completed_at <= a.scheduled_for + INTERVAL '7 days'
     ),
     returning AS (
       SELECT DISTINCT first_a.call_log_id AS id
         FROM appointments first_a
        WHERE first_a.practice_id = $1 AND first_a.call_log_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM appointments later_a
             WHERE later_a.patient_id = first_a.patient_id
               AND later_a.scheduled_for > first_a.scheduled_for
               AND later_a.status = 'completed'
          )
     )
     SELECT
       (SELECT COUNT(*)::int FROM calls)               AS step1_calls,
       (SELECT COUNT(*)::int FROM intake_complete)     AS step2_intake,
       (SELECT COUNT(*)::int FROM booked)              AS step3_booked,
       (SELECT COUNT(*)::int FROM attended)            AS step4_attended,
       (SELECT COUNT(*)::int FROM phq9_done)           AS step5_phq9,
       (SELECT COUNT(*)::int FROM returning)           AS step6_returning`,
    [ctx.practiceId],
  ).catch(() => ({ rows: [{}] as any[] }))

  await auditEhrAccess({ ctx, action: 'receptionist_funnel.viewed' as any, resourceType: 'practice', details: { days } })

  return NextResponse.json({ ...r.rows[0], window_days: days })
}
