// app/api/ehr/admin/therapist-scorecards/route.ts
//
// W47 T3 — admin comparison view of all therapists in the practice.
// Extends W44 T1 productivity report with retention + outcomes.
//
// Admin / supervisor only. Caller decides who's allowed at the route
// layer; we gate on ADMIN_EMAIL allowlist for now (same pattern as
// W44 T4 patient merge).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false
  const allow = (process.env.ADMIN_EMAIL || 'chancewonser@gmail.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  return allow.includes(email.toLowerCase())
}

function isoDate(s: string | null, fallback: string): string {
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return fallback
}
function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!isAdminEmail(ctx.session?.email)) {
    return NextResponse.json({ error: 'admin_only' }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  const from = isoDate(sp.get('from'), monthAgo)
  const to = isoDate(sp.get('to'), today)
  const format = sp.get('format') === 'csv' ? 'csv' : 'json'

  // Single CTE-based query — same shape as W44 T1 plus retention +
  // outcomes columns.
  const { rows } = await pool.query(
    `WITH appt AS (
       SELECT a.therapist_id, a.id, a.status, a.late_canceled_at,
              a.scheduled_for, a.duration_minutes, a.patient_id
         FROM appointments a
        WHERE a.practice_id = $1
          AND a.scheduled_for::date BETWEEN $2::date AND $3::date
     ),
     appt_agg AS (
       SELECT therapist_id,
              COUNT(*)::int AS scheduled_count,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS kept_count,
              COUNT(*) FILTER (WHERE status = 'no_show')::int   AS no_show_count,
              COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_count,
              COUNT(*) FILTER (WHERE status = 'cancelled' AND late_canceled_at IS NOT NULL)::int AS late_cancel_count,
              AVG(duration_minutes) FILTER (WHERE status = 'completed') AS avg_duration_minutes,
              COUNT(DISTINCT patient_id) FILTER (WHERE status = 'completed')::int AS distinct_patients_seen
         FROM appt
        GROUP BY therapist_id
     ),
     note_agg AS (
       SELECT n.therapist_id,
              COUNT(*) FILTER (WHERE n.signed_at IS NOT NULL)::int AS notes_total,
              COUNT(*) FILTER (
                WHERE n.signed_at IS NOT NULL
                  AND a.scheduled_for IS NOT NULL
                  AND n.signed_at <= a.scheduled_for + INTERVAL '72 hours'
              )::int AS notes_signed_within_72h,
              COUNT(*) FILTER (WHERE n.requires_cosign = true)::int AS cosign_required_count,
              COUNT(*) FILTER (WHERE n.requires_cosign = true AND n.cosigned_at IS NOT NULL)::int AS cosign_completed_count,
              AVG(EXTRACT(EPOCH FROM (n.cosigned_at - n.signed_at)) / 3600)
                FILTER (WHERE n.requires_cosign = true AND n.cosigned_at IS NOT NULL AND n.signed_at IS NOT NULL)
                                                                                  AS avg_cosign_hours
         FROM ehr_progress_notes n
         LEFT JOIN appointments a ON a.id = n.appointment_id
        WHERE n.practice_id = $1
          AND COALESCE(a.scheduled_for::date, n.created_at::date) BETWEEN $2::date AND $3::date
        GROUP BY n.therapist_id
     ),
     -- Retention: patients with ≥1 completed appointment in the window
     -- AND a still-scheduled future appointment OR another completed
     -- session within 30 days after their first session in the window.
     retention AS (
       SELECT a1.therapist_id,
              COUNT(DISTINCT a1.patient_id)::int AS first_seen,
              COUNT(DISTINCT CASE WHEN EXISTS (
                  SELECT 1 FROM appointments a2
                   WHERE a2.therapist_id = a1.therapist_id
                     AND a2.patient_id   = a1.patient_id
                     AND a2.status       IN ('completed','scheduled','confirmed')
                     AND a2.scheduled_for > a1.scheduled_for
                     AND a2.scheduled_for <= a1.scheduled_for + INTERVAL '30 days'
                ) THEN a1.patient_id END)::int AS retained
         FROM appt a1
        WHERE a1.status = 'completed'
        GROUP BY a1.therapist_id
     ),
     -- Outcomes: average PHQ-9 score change for patients who had ≥2
     -- PHQ-9 administrations in the window. Therapist association
     -- via the patient's most-recent therapist on completed appts.
     outcomes AS (
       SELECT a.therapist_id,
              AVG(latest.score - earliest.score)::float AS avg_phq9_delta,
              COUNT(*)::int                              AS phq9_patients
         FROM (
           SELECT DISTINCT ON (therapist_id, patient_id)
                  therapist_id, patient_id, scheduled_for
             FROM appt
            WHERE status = 'completed'
            ORDER BY therapist_id, patient_id, scheduled_for DESC
         ) a
         JOIN LATERAL (
           SELECT total_score::float AS score, completed_at
             FROM outcome_assessments oa
            WHERE oa.practice_id = $1
              AND oa.patient_id  = a.patient_id
              AND oa.instrument  = 'PHQ-9'
              AND oa.completed_at::date BETWEEN $2::date AND $3::date
            ORDER BY oa.completed_at ASC LIMIT 1
         ) earliest ON TRUE
         JOIN LATERAL (
           SELECT total_score::float AS score, completed_at
             FROM outcome_assessments oa
            WHERE oa.practice_id = $1
              AND oa.patient_id  = a.patient_id
              AND oa.instrument  = 'PHQ-9'
              AND oa.completed_at::date BETWEEN $2::date AND $3::date
            ORDER BY oa.completed_at DESC LIMIT 1
         ) latest   ON latest.completed_at > earliest.completed_at
        GROUP BY a.therapist_id
     )
     SELECT t.id::text AS therapist_id,
            COALESCE(t.first_name || ' ' || t.last_name, '— Unassigned') AS therapist_name,
            COALESCE(aa.scheduled_count, 0)::int                         AS scheduled_count,
            COALESCE(aa.kept_count, 0)::int                              AS kept_count,
            COALESCE(aa.no_show_count, 0)::int                           AS no_show_count,
            COALESCE(aa.late_cancel_count, 0)::int                       AS late_cancel_count,
            COALESCE(aa.cancelled_count, 0)::int                         AS cancelled_count,
            COALESCE(aa.distinct_patients_seen, 0)::int                  AS distinct_patients_seen,
            CASE WHEN COALESCE(aa.scheduled_count, 0) > 0
                 THEN COALESCE(aa.kept_count, 0)::numeric / aa.scheduled_count
                 ELSE 0 END                                              AS kept_rate,
            CASE WHEN COALESCE(aa.scheduled_count, 0) > 0
                 THEN COALESCE(aa.no_show_count, 0)::numeric / aa.scheduled_count
                 ELSE 0 END                                              AS no_show_rate,
            CASE WHEN COALESCE(aa.scheduled_count, 0) > 0
                 THEN COALESCE(aa.late_cancel_count, 0)::numeric / aa.scheduled_count
                 ELSE 0 END                                              AS late_cancel_rate,
            COALESCE(na.notes_total, 0)::int                             AS notes_total,
            CASE WHEN COALESCE(na.notes_total, 0) > 0
                 THEN COALESCE(na.notes_signed_within_72h, 0)::numeric / na.notes_total
                 ELSE 0 END                                              AS timely_note_rate,
            aa.avg_duration_minutes,
            COALESCE(na.cosign_required_count, 0)::int                   AS cosign_required_count,
            COALESCE(na.cosign_completed_count, 0)::int                  AS cosign_completed_count,
            na.avg_cosign_hours,
            COALESCE(r.first_seen, 0)::int                               AS retention_first_seen,
            COALESCE(r.retained, 0)::int                                 AS retention_retained,
            CASE WHEN COALESCE(r.first_seen, 0) > 0
                 THEN COALESCE(r.retained, 0)::numeric / r.first_seen
                 ELSE 0 END                                              AS retention_rate,
            o.avg_phq9_delta,
            COALESCE(o.phq9_patients, 0)::int                            AS phq9_patients
       FROM therapists t
       LEFT JOIN appt_agg aa ON aa.therapist_id = t.id
       LEFT JOIN note_agg na ON na.therapist_id = t.id
       LEFT JOIN retention r ON r.therapist_id = t.id
       LEFT JOIN outcomes  o ON o.therapist_id = t.id
      WHERE t.practice_id = $1
      ORDER BY scheduled_count DESC, therapist_name`,
    [ctx.practiceId, from, to],
  )

  if (format === 'csv') {
    const headers = [
      'therapist_id','therapist_name','scheduled','kept','no_show','late_cancel','cancelled',
      'distinct_patients','kept_rate','no_show_rate','late_cancel_rate',
      'notes_total','timely_note_rate','avg_duration_minutes',
      'cosign_required','cosign_completed','avg_cosign_hours',
      'retention_first_seen','retention_retained','retention_rate',
      'avg_phq9_delta','phq9_patients',
    ]
    const lines = [headers.join(',')]
    for (const r of rows) {
      lines.push([
        r.therapist_id, r.therapist_name,
        r.scheduled_count, r.kept_count, r.no_show_count, r.late_cancel_count, r.cancelled_count,
        r.distinct_patients_seen,
        Number(r.kept_rate).toFixed(3),
        Number(r.no_show_rate).toFixed(3),
        Number(r.late_cancel_rate).toFixed(3),
        r.notes_total,
        Number(r.timely_note_rate).toFixed(3),
        r.avg_duration_minutes != null ? Number(r.avg_duration_minutes).toFixed(1) : '',
        r.cosign_required_count, r.cosign_completed_count,
        r.avg_cosign_hours != null ? Number(r.avg_cosign_hours).toFixed(2) : '',
        r.retention_first_seen, r.retention_retained,
        Number(r.retention_rate).toFixed(3),
        r.avg_phq9_delta != null ? Number(r.avg_phq9_delta).toFixed(2) : '',
        r.phq9_patients,
      ].map(csvEscape).join(','))
    }
    await auditEhrAccess({
      ctx, action: 'therapist_scorecards.exported',
      resourceType: 'therapist_scorecards',
      details: { therapist_count: rows.length },
    })
    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="therapist-scorecards-${from}-to-${to}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  await auditEhrAccess({
    ctx, action: 'therapist_scorecards.viewed',
    resourceType: 'therapist_scorecards',
    details: { therapist_count: rows.length, range_days: Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) },
  })

  return NextResponse.json({ from, to, rows })
}
