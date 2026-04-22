// app/api/ehr/reports/productivity/route.ts
// Practice-wide productivity rollup. Answers:
//   - how many hours did the therapist see this week vs. last week
//   - how many notes are still drafts, and how old is the oldest one
//   - no-show rate, cancellation rate
//   - new patients this month
//   - goal progress across active treatment plans
//   - pending assessments + pending cosigns
//
// One endpoint, all the data the reports page needs. Server-side aggregation.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'

function isoDaysAgo(days: number): string {
  const d = new Date(); d.setDate(d.getDate() - days)
  return d.toISOString()
}
function dateDaysAgo(days: number): string {
  const d = new Date(); d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { practiceId } = auth

  // Parallel fetch — limit to last 90 days for most things
  const [weekAppts, last30Appts, draftNotes, signedNotes, recentPatients, activePlans, pendingAssess, pendingCosigns] = await Promise.all([
    supabaseAdmin.from('appointments')
      .select('id, appointment_date, duration_minutes, actual_started_at, actual_ended_at, status')
      .eq('practice_id', practiceId)
      .gte('appointment_date', dateDaysAgo(7))
      .limit(200),
    supabaseAdmin.from('appointments')
      .select('id, status, appointment_date')
      .eq('practice_id', practiceId)
      .gte('appointment_date', dateDaysAgo(30))
      .limit(500),
    supabaseAdmin.from('ehr_progress_notes')
      .select('id, title, patient_id, created_at')
      .eq('practice_id', practiceId).eq('status', 'draft')
      .order('created_at', { ascending: true })
      .limit(50),
    supabaseAdmin.from('ehr_progress_notes')
      .select('id, signed_at')
      .eq('practice_id', practiceId).in('status', ['signed', 'amended'])
      .gte('signed_at', isoDaysAgo(30))
      .limit(500),
    supabaseAdmin.from('patients')
      .select('id, first_name, last_name, created_at')
      .eq('practice_id', practiceId)
      .gte('created_at', isoDaysAgo(30))
      .order('created_at', { ascending: false })
      .limit(50),
    supabaseAdmin.from('ehr_treatment_plans')
      .select('id, patient_id, goals, start_date, review_date')
      .eq('practice_id', practiceId).eq('status', 'active'),
    supabaseAdmin.from('patient_assessments')
      .select('id')
      .eq('practice_id', practiceId).eq('status', 'pending'),
    supabaseAdmin.from('ehr_progress_notes')
      .select('id, title, patient_id, signed_at')
      .eq('practice_id', practiceId).eq('requires_cosign', true).is('cosigned_at', null)
      .order('signed_at', { ascending: true })
      .limit(50),
  ])

  // Hours seen in the last 7 days — use actual time if available, else scheduled duration for completed
  let sevenDayMinutes = 0
  let sevenDayCompleted = 0
  for (const a of weekAppts.data || []) {
    if (a.status === 'completed') {
      sevenDayCompleted++
      if (a.actual_started_at && a.actual_ended_at) {
        sevenDayMinutes += Math.max(0, Math.round((new Date(a.actual_ended_at).getTime() - new Date(a.actual_started_at).getTime()) / 60000))
      } else {
        sevenDayMinutes += a.duration_minutes || 0
      }
    }
  }

  // Rates across the last 30 days
  const total30 = (last30Appts.data || []).length
  const completed30 = (last30Appts.data || []).filter((a) => a.status === 'completed').length
  const noShow30 = (last30Appts.data || []).filter((a) => a.status === 'no-show').length
  const cancelled30 = (last30Appts.data || []).filter((a) => a.status === 'cancelled').length

  // Oldest draft age
  const oldestDraft = draftNotes.data?.[0]
  const oldestDraftDays = oldestDraft
    ? Math.floor((Date.now() - new Date(oldestDraft.created_at).getTime()) / (24 * 60 * 60 * 1000))
    : null

  // Goal counts across active plans
  const plans = activePlans.data ?? []
  let totalGoals = 0
  for (const p of plans) totalGoals += (Array.isArray(p.goals) ? p.goals.length : 0)
  const plansNeedingReview = plans.filter((p) => p.review_date && new Date(p.review_date).getTime() < Date.now()).length

  return NextResponse.json({
    window: { last7days: true, last30days: true },
    hours_seen_7d: +(sevenDayMinutes / 60).toFixed(1),
    sessions_completed_7d: sevenDayCompleted,
    notes: {
      drafts_outstanding: draftNotes.data?.length ?? 0,
      oldest_draft_days: oldestDraftDays,
      oldest_draft_title: oldestDraft?.title ?? null,
      oldest_draft_id: oldestDraft?.id ?? null,
      oldest_draft_patient_id: oldestDraft?.patient_id ?? null,
      signed_30d: signedNotes.data?.length ?? 0,
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
      count: recentPatients.data?.length ?? 0,
      list: (recentPatients.data ?? []).slice(0, 10).map((p: any) => ({
        id: p.id, name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(), since: p.created_at,
      })),
    },
    goals: {
      active_plans: plans.length,
      total_goals: totalGoals,
      plans_needing_review: plansNeedingReview,
    },
    pending_assessments: pendingAssess.data?.length ?? 0,
    pending_cosigns: {
      count: pendingCosigns.data?.length ?? 0,
      oldest_days: pendingCosigns.data?.[0]?.signed_at
        ? Math.floor((Date.now() - new Date(pendingCosigns.data[0].signed_at).getTime()) / (24 * 60 * 60 * 1000))
        : null,
    },
  })
}
