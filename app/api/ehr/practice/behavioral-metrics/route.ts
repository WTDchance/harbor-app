// W52 D3 — practice behavioral signal aggregates.
import { NextResponse } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  // Call → booking conversion (any appointment created with a call_log_id).
  const calls = await pool.query(
    `SELECT
       COUNT(*)::int AS total_calls,
       COUNT(*) FILTER (WHERE patient_id IS NOT NULL)::int AS captured_patient,
       (SELECT COUNT(DISTINCT call_log_id)::int FROM appointments
          WHERE practice_id = $1 AND call_log_id IS NOT NULL
            AND created_at >= NOW() - INTERVAL '90 days') AS booked_from_calls
       FROM call_logs
      WHERE practice_id = $1 AND created_at >= NOW() - INTERVAL '90 days'`,
    [ctx.practiceId],
  ).catch(() => ({ rows: [{ total_calls: 0, captured_patient: 0, booked_from_calls: 0 }] }))

  // No-show rate by predicted-risk-bucket (validates the W50 model).
  const noShowByPred = await pool.query(
    `SELECT
       CASE
         WHEN p.no_show_prob >= 0.7 THEN 'high'
         WHEN p.no_show_prob >= 0.4 THEN 'medium'
         ELSE 'low'
       END AS bucket,
       COUNT(*)::int AS appts,
       COUNT(*) FILTER (WHERE a.status = 'no_show')::int AS no_shows
       FROM appointments a
       LEFT JOIN LATERAL (
         SELECT no_show_prob FROM ehr_patient_predictions_v2
          WHERE practice_id = a.practice_id AND patient_id = a.patient_id
          ORDER BY computed_at DESC LIMIT 1
       ) p ON TRUE
      WHERE a.practice_id = $1
        AND a.scheduled_for >= NOW() - INTERVAL '180 days'
        AND a.scheduled_for <= NOW()
        AND a.status IN ('completed','no_show','cancelled')
      GROUP BY bucket`,
    [ctx.practiceId],
  ).catch(() => ({ rows: [] as any[] }))

  // Average days from receptionist call to first appointment.
  const callToBook = await pool.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (a.created_at - c.created_at)) / 86400)::numeric(10,2) AS avg_days
       FROM appointments a
       JOIN call_logs c ON c.id = a.call_log_id
      WHERE a.practice_id = $1
        AND c.created_at >= NOW() - INTERVAL '90 days'`,
    [ctx.practiceId],
  ).catch(() => ({ rows: [{ avg_days: null }] }))

  // Sessions per active patient + attendance rate.
  const attend = await pool.query(
    `SELECT
       COUNT(DISTINCT patient_id)::int AS active_patients,
       COUNT(*) FILTER (WHERE status = 'completed')::int AS kept,
       COUNT(*)::int AS total
       FROM appointments
      WHERE practice_id = $1
        AND scheduled_for >= NOW() - INTERVAL '90 days'`,
    [ctx.practiceId],
  ).catch(() => ({ rows: [{ active_patients: 0, kept: 0, total: 0 }] }))

  await auditEhrAccess({ ctx, action: 'behavioral_metrics.viewed' as any, resourceType: 'practice' })

  return NextResponse.json({
    calls: calls.rows[0],
    no_show_by_predicted_risk: noShowByPred.rows,
    avg_call_to_book_days: callToBook.rows[0]?.avg_days,
    attendance: {
      active_patients_90d: attend.rows[0]?.active_patients ?? 0,
      kept: attend.rows[0]?.kept ?? 0,
      total: attend.rows[0]?.total ?? 0,
      rate: attend.rows[0]?.total > 0
        ? Math.round((attend.rows[0].kept / attend.rows[0].total) * 1000) / 10
        : 0,
      sessions_per_active_patient: attend.rows[0]?.active_patients > 0
        ? Math.round((attend.rows[0].kept / attend.rows[0].active_patients) * 100) / 100
        : 0,
    },
  })
}
