// Practice productivity rollup. Last-7d hours seen, draft-note backlog,
// 30d no-show / cancellation rates, new-patient list, active-plan + pending-
// cosign + pending-assessment counts. One endpoint, parallel SELECTs.
//
// AWS canonical schema notes:
//   - appointments.scheduled_for replaces the legacy appointment_date column.
//   - actual_started_at / actual_ended_at don't exist on AWS — minutes-seen
//     derives from duration_minutes when status='completed'.

import { NextResponse } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isoDaysAgo(days: number): string {
  const d = new Date(); d.setDate(d.getDate() - days)
  return d.toISOString()
}

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 404 })

  const sevenDaysAgo = isoDaysAgo(7)
  const thirtyDaysAgo = isoDaysAgo(30)

  const [
    weekAppts, last30Appts, draftNotes, signedNotes,
    recentPatients, activePlans, pendingAssess, pendingCosigns,
  ] = await Promise.all([
    pool.query(
      `SELECT id, scheduled_for, duration_minutes, status
         FROM appointments
        WHERE practice_id = $1 AND scheduled_for >= $2
        LIMIT 200`,
      [ctx.practiceId, sevenDaysAgo],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT id, status, scheduled_for
         FROM appointments
        WHERE practice_id = $1 AND scheduled_for >= $2
        LIMIT 500`,
      [ctx.practiceId, thirtyDaysAgo],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT id, title, patient_id, created_at
         FROM ehr_progress_notes
        WHERE practice_id = $1 AND status = 'draft'
        ORDER BY created_at ASC LIMIT 50`,
      [ctx.practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT id, signed_at FROM ehr_progress_notes
        WHERE practice_id = $1
          AND status IN ('signed', 'amended')
          AND signed_at >= $2
        LIMIT 500`,
      [ctx.practiceId, thirtyDaysAgo],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT id, first_name, last_name, created_at
         FROM patients
        WHERE practice_id = $1 AND created_at >= $2
        ORDER BY created_at DESC LIMIT 50`,
      [ctx.practiceId, thirtyDaysAgo],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT id, patient_id, goals, start_date, review_date
         FROM ehr_treatment_plans
        WHERE practice_id = $1 AND status = 'active'`,
      [ctx.practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT id FROM patient_assessments
        WHERE practice_id = $1 AND status = 'pending'`,
      [ctx.practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT id, title, patient_id, signed_at
         FROM ehr_progress_notes
        WHERE practice_id = $1
          AND requires_cosign = true
          AND cosigned_at IS NULL
        ORDER BY signed_at ASC LIMIT 50`,
      [ctx.practiceId],
    ).catch(() => ({ rows: [] as any[] })),
  ])

  // 7-day hours seen — from duration_minutes on completed appointments.
  let sevenDayMinutes = 0
  let sevenDayCompleted = 0
  for (const a of weekAppts.rows) {
    if (a.status === 'completed') {
      sevenDayCompleted++
      sevenDayMinutes += a.duration_minutes || 0
    }
  }

  const all30 = last30Appts.rows
  const total30 = all30.length
  const completed30 = all30.filter(a => a.status === 'completed').length
  const noShow30 = all30.filter(a => a.status === 'no_show' || a.status === 'no-show').length
  const cancelled30 = all30.filter(a => a.status === 'cancelled').length

  const drafts = draftNotes.rows
  const oldest = drafts[0]
  const oldestDays = oldest
    ? Math.floor((Date.now() - new Date(oldest.created_at).getTime()) / 86_400_000)
    : null

  const plans = activePlans.rows
  let totalGoals = 0
  for (const p of plans) totalGoals += Array.isArray(p.goals) ? p.goals.length : 0
  const plansNeedingReview = plans.filter(
    p => p.review_date && new Date(p.review_date).getTime() < Date.now(),
  ).length

  const cosignOldest = pendingCosigns.rows[0]?.signed_at
  const cosignOldestDays = cosignOldest
    ? Math.floor((Date.now() - new Date(cosignOldest).getTime()) / 86_400_000)
    : null

  return NextResponse.json({
    window: { last7days: true, last30days: true },
    hours_seen_7d: +(sevenDayMinutes / 60).toFixed(1),
    sessions_completed_7d: sevenDayCompleted,
    notes: {
      drafts_outstanding: drafts.length,
      oldest_draft_days: oldestDays,
      oldest_draft_title: oldest?.title ?? null,
      oldest_draft_id: oldest?.id ?? null,
      oldest_draft_patient_id: oldest?.patient_id ?? null,
      signed_30d: signedNotes.rows.length,
    },
    appointments: {
      total_30d: total30,
      completed_30d: completed30,
      no_show_30d: noShow30,
      cancelled_30d: cancelled30,
      no_show_rate_30d: total30 ? +(noShow30 / total30 * 100).toFixed(1) : 0,
      cancellation_rate_30d: total30 ? +(cancelled30 / total30 * 100).toFixed(1) : 0,
    },
    new_patients_30d: {
      count: recentPatients.rows.length,
      list: recentPatients.rows.slice(0, 10).map(p => ({
        id: p.id,
        name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
        since: p.created_at,
      })),
    },
    goals: {
      active_plans: plans.length,
      total_goals: totalGoals,
      plans_needing_review: plansNeedingReview,
    },
    pending_assessments: pendingAssess.rows.length,
    pending_cosigns: {
      count: pendingCosigns.rows.length,
      oldest_days: cosignOldestDays,
    },
  })
}
