// app/api/ehr/admin/productivity/route.ts
//
// W44 T1 — admin/supervisor productivity report.
//
// Per-therapist metrics over a selectable date range. All read-only —
// computed off existing tables (appointments, ehr_progress_notes,
// therapists). No schema changes.
//
// Note on cancel-actor: the appointments table doesn't currently
// track which side initiated a cancel, so kept_rate uses
// kept / scheduled (not kept / scheduled-minus-therapist-cancels as
// originally proposed). late_cancel_rate uses appointments.late_canceled_at
// (W42 T2 cancellation policy migration).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Row = {
  therapist_id: string | null
  therapist_name: string | null
  scheduled_count: number
  kept_count: number
  no_show_count: number
  late_cancel_count: number
  cancelled_count: number
  kept_rate: number
  no_show_rate: number
  late_cancel_rate: number
  notes_total: number
  notes_signed_within_72h: number
  timely_note_rate: number
  avg_duration_minutes: number | null
  cosign_required_count: number
  cosign_completed_count: number
  avg_cosign_hours: number | null
}

function isoDate(s: string | null, fallback: string): string {
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return fallback
}

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const now = new Date()
  const firstOfMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
  const today = now.toISOString().slice(0, 10)

  const sp = req.nextUrl.searchParams
  const from = isoDate(sp.get('from'), firstOfMonth)
  const to = isoDate(sp.get('to'), today)

  const { rows } = await pool.query<Row>(
    `WITH appt AS (
       SELECT
         a.therapist_id,
         a.id,
         a.status,
         a.late_canceled_at,
         a.scheduled_for,
         a.duration_minutes
       FROM appointments a
       WHERE a.practice_id = $1
         AND a.scheduled_for::date >= $2::date
         AND a.scheduled_for::date <= $3::date
     ),
     appt_agg AS (
       SELECT
         therapist_id,
         COUNT(*)::int AS scheduled_count,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS kept_count,
         COUNT(*) FILTER (WHERE status = 'no_show')::int   AS no_show_count,
         COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_count,
         COUNT(*) FILTER (WHERE status = 'cancelled' AND late_canceled_at IS NOT NULL)::int
                                                           AS late_cancel_count,
         AVG(duration_minutes) FILTER (WHERE status = 'completed') AS avg_duration_minutes
       FROM appt
       GROUP BY therapist_id
     ),
     note_agg AS (
       SELECT
         n.therapist_id,
         COUNT(*) FILTER (WHERE n.signed_at IS NOT NULL)::int AS notes_total,
         COUNT(*) FILTER (
           WHERE n.signed_at IS NOT NULL
             AND a.scheduled_for IS NOT NULL
             AND n.signed_at <= a.scheduled_for + INTERVAL '72 hours'
         )::int AS notes_signed_within_72h,
         COUNT(*) FILTER (WHERE n.requires_cosign = true)::int                          AS cosign_required_count,
         COUNT(*) FILTER (WHERE n.requires_cosign = true AND n.cosigned_at IS NOT NULL)::int AS cosign_completed_count,
         AVG(EXTRACT(EPOCH FROM (n.cosigned_at - n.signed_at)) / 3600)
           FILTER (WHERE n.requires_cosign = true AND n.cosigned_at IS NOT NULL AND n.signed_at IS NOT NULL)
                                                                                        AS avg_cosign_hours
       FROM ehr_progress_notes n
       LEFT JOIN appointments a ON a.id = n.appointment_id
       WHERE n.practice_id = $1
         AND COALESCE(a.scheduled_for::date, n.created_at::date) >= $2::date
         AND COALESCE(a.scheduled_for::date, n.created_at::date) <= $3::date
       GROUP BY n.therapist_id
     )
     SELECT
       COALESCE(aa.therapist_id, na.therapist_id)::text                  AS therapist_id,
       COALESCE(t.first_name || ' ' || t.last_name, '— Unassigned')      AS therapist_name,
       COALESCE(aa.scheduled_count, 0)::int                              AS scheduled_count,
       COALESCE(aa.kept_count, 0)::int                                   AS kept_count,
       COALESCE(aa.no_show_count, 0)::int                                AS no_show_count,
       COALESCE(aa.late_cancel_count, 0)::int                            AS late_cancel_count,
       COALESCE(aa.cancelled_count, 0)::int                              AS cancelled_count,
       CASE WHEN COALESCE(aa.scheduled_count, 0) > 0
            THEN COALESCE(aa.kept_count, 0)::numeric / aa.scheduled_count
            ELSE 0 END                                                   AS kept_rate,
       CASE WHEN COALESCE(aa.scheduled_count, 0) > 0
            THEN COALESCE(aa.no_show_count, 0)::numeric / aa.scheduled_count
            ELSE 0 END                                                   AS no_show_rate,
       CASE WHEN COALESCE(aa.scheduled_count, 0) > 0
            THEN COALESCE(aa.late_cancel_count, 0)::numeric / aa.scheduled_count
            ELSE 0 END                                                   AS late_cancel_rate,
       COALESCE(na.notes_total, 0)::int                                  AS notes_total,
       COALESCE(na.notes_signed_within_72h, 0)::int                      AS notes_signed_within_72h,
       CASE WHEN COALESCE(na.notes_total, 0) > 0
            THEN COALESCE(na.notes_signed_within_72h, 0)::numeric / na.notes_total
            ELSE 0 END                                                   AS timely_note_rate,
       aa.avg_duration_minutes,
       COALESCE(na.cosign_required_count, 0)::int                        AS cosign_required_count,
       COALESCE(na.cosign_completed_count, 0)::int                       AS cosign_completed_count,
       na.avg_cosign_hours
     FROM appt_agg aa
     FULL OUTER JOIN note_agg na ON na.therapist_id = aa.therapist_id
     LEFT JOIN therapists t ON t.id = COALESCE(aa.therapist_id, na.therapist_id)
     ORDER BY scheduled_count DESC, therapist_name`,
    [ctx.practiceId, from, to],
  )

  await auditEhrAccess({
    ctx,
    action: 'productivity_report.viewed',
    resourceType: 'productivity_report',
    details: {
      therapist_count: rows.length,
      range_days: Math.max(1, Math.round(
        (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000,
      )),
    },
  })

  return NextResponse.json({ from, to, rows })
}
