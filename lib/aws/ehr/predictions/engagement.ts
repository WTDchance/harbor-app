// lib/aws/ehr/predictions/engagement.ts
//
// W45 T5 — engagement score heuristic. Composite 0..1 where higher =
// more engaged. dropout_risk is just (1 - engagement_score) and is
// stored as its own row so the UI can read either kind directly.
//
// Inputs (all from ehr_patient_signals — pure read, no operational
// table joins):
//   * Portal logins per week, last 30 days   — 0.20
//   * Message-thread responsiveness            — 0.15  (proxy: portal_message_*
//                                                       signals if present;
//                                                       falls back to 0.5)
//   * Homework completion rate                 — 0.15  (homework_completed vs
//                                                       homework_missed)
//   * Session attendance rate                  — 0.20  (kept vs no-show + late_cancel)
//   * Appointment cadence consistency          — 0.10  (variance in inter-appointment days)
//   * Days since last meaningful interaction   — 0.10
//   * Assessment completion rate               — 0.10  (assessment_completed in window)
//
// Weights sum to 1.00. Each contribution is 0..1 where higher = more
// engaged. Final score = sum(weight × contribution), clamped to [0,1].
//
// Brand-new patients (no signals at all) score 0.5 (neutral) so the
// dropout_risk doesn't immediately flag them as at-risk. The score
// becomes meaningful as the patient accrues 2-3 weeks of history.

import { pool } from '@/lib/aws/db'
import { clamp01, summarizeContributions, type PredictionFactor, type PredictionFactors } from './types'

export const ENGAGEMENT_MODEL_VERSION = 'engagement.heuristic.v1'

const WEIGHTS = {
  portal_logins:        0.20,
  message_responsive:   0.15,
  homework_completion:  0.15,
  attendance_rate:      0.20,
  cadence_consistency:  0.10,
  days_since_last:      0.10,
  assessment_completion: 0.10,
}

type Signal = { signal_kind: string; observed_at: string; value: any }

async function loadSignals(practiceId: string, patientId: string): Promise<Signal[]> {
  const { rows } = await pool.query<Signal>(
    `SELECT signal_kind, observed_at::text, value
       FROM ehr_patient_signals
      WHERE practice_id = $1 AND patient_id = $2
        AND observed_at >= NOW() - INTERVAL '180 days'
      ORDER BY observed_at DESC
      LIMIT 1000`,
    [practiceId, patientId],
  )
  return rows
}

function daysAgo(when: string | Date): number {
  const d = typeof when === 'string' ? new Date(when) : when
  return (Date.now() - d.getTime()) / 86_400_000
}

// ---- contribution calculators ---------------------------------------

function portalLoginContribution(signals: Signal[]): { value: number; per_week: number } {
  const recent = signals.filter((s) => s.signal_kind === 'portal_login' && daysAgo(s.observed_at) <= 30)
  const perWeek = recent.length / (30 / 7)
  // 1+/week → contribution 1.0. Linearly scale.
  const sub = clamp01(perWeek / 1)
  return { value: sub, per_week: Number(perWeek.toFixed(2)) }
}

function messageResponsiveContribution(signals: Signal[]): { value: number; sample: number } {
  const sent = signals.filter((s) => s.signal_kind === 'portal_message_sent').length
  const read = signals.filter((s) => s.signal_kind === 'portal_message_read').length
  if (sent === 0) return { value: 0.5, sample: 0 } // unknown — neutral
  return { value: clamp01(read / sent), sample: sent }
}

function homeworkContribution(signals: Signal[]): { value: number; sample: number } {
  const done = signals.filter((s) => s.signal_kind === 'homework_completed').length
  const missed = signals.filter((s) => s.signal_kind === 'homework_missed').length
  const total = done + missed
  if (total === 0) return { value: 0.5, sample: 0 }
  return { value: clamp01(done / total), sample: total }
}

function attendanceContribution(signals: Signal[]): { value: number; sample: number } {
  const kept = signals.filter((s) => s.signal_kind === 'appointment_kept').length
  const noShow = signals.filter((s) => s.signal_kind === 'appointment_no_show').length
  const lateCancel = signals.filter((s) => s.signal_kind === 'appointment_late_cancel').length
  const total = kept + noShow + lateCancel
  if (total === 0) return { value: 0.5, sample: 0 }
  // Late cancel is half-credit (engaged enough to cancel, but disrupts).
  return { value: clamp01((kept + lateCancel * 0.5) / total), sample: total }
}

function cadenceConsistencyContribution(signals: Signal[]): { value: number; sample: number } {
  // Coefficient of variation of inter-appointment intervals. Lower CV
  // = more consistent = more engaged.
  const dates = signals
    .filter((s) => s.signal_kind === 'appointment_kept')
    .map((s) => new Date(s.observed_at).getTime())
    .sort((a, b) => a - b)
  if (dates.length < 4) return { value: 0.5, sample: dates.length } // unknown
  const intervals: number[] = []
  for (let i = 1; i < dates.length; i++) {
    intervals.push((dates[i] - dates[i - 1]) / 86_400_000)
  }
  const mean = intervals.reduce((s, n) => s + n, 0) / intervals.length
  if (mean === 0) return { value: 0.5, sample: intervals.length }
  const variance = intervals.reduce((s, n) => s + (n - mean) ** 2, 0) / intervals.length
  const cv = Math.sqrt(variance) / mean
  // CV 0 → 1.0, CV 1 → 0.0 (very erratic).
  return { value: clamp01(1 - cv), sample: intervals.length }
}

function daysSinceLastContribution(signals: Signal[]): { value: number; days: number } {
  if (signals.length === 0) return { value: 0.5, days: -1 } // unknown
  // Most recent signal of any kind that implies engagement.
  const meaningfulKinds = new Set([
    'portal_login', 'portal_message_sent', 'reminder_response',
    'appointment_kept', 'homework_completed', 'assessment_completed',
  ])
  const last = signals.find((s) => meaningfulKinds.has(s.signal_kind))
  if (!last) return { value: 0, days: 999 }
  const days = daysAgo(last.observed_at)
  // 0 days → 1.0, 30 days → 0, linear.
  return { value: clamp01(1 - days / 30), days: Math.round(days) }
}

function assessmentCompletionContribution(signals: Signal[]): { value: number; in_90d: number } {
  const recent = signals.filter(
    (s) => s.signal_kind === 'assessment_completed' && daysAgo(s.observed_at) <= 90,
  )
  // 1+ assessments in last 90 days → 1.0. Linearly scale 0 → 0.0, 1 → 1.0.
  return { value: clamp01(recent.length / 1), in_90d: recent.length }
}

// ---- main entry -----------------------------------------------------

export async function computeEngagement(
  practiceId: string,
  patientId: string,
): Promise<{ score: number; factors: PredictionFactors }> {
  const signals = await loadSignals(practiceId, patientId)

  const f1 = portalLoginContribution(signals)
  const f2 = messageResponsiveContribution(signals)
  const f3 = homeworkContribution(signals)
  const f4 = attendanceContribution(signals)
  const f5 = cadenceConsistencyContribution(signals)
  const f6 = daysSinceLastContribution(signals)
  const f7 = assessmentCompletionContribution(signals)

  const contributions: PredictionFactor[] = [
    {
      name: 'portal_logins',
      label: `Portal logins ${f1.per_week}/week (last 30d)`,
      weight: WEIGHTS.portal_logins,
      value: f1.per_week,
      normalized_score: f1.value,
    },
    {
      name: 'message_responsive',
      label: f2.sample > 0 ? `Read ${f2.sample} sent messages` : 'No portal messages on file',
      weight: WEIGHTS.message_responsive,
      value: f2.sample,
      normalized_score: f2.value,
    },
    {
      name: 'homework_completion',
      label: f3.sample > 0 ? `Homework completion (${f3.sample} assignments)` : 'No homework on file',
      weight: WEIGHTS.homework_completion,
      value: f3.sample,
      normalized_score: f3.value,
    },
    {
      name: 'attendance_rate',
      label: f4.sample > 0 ? `Attendance over ${f4.sample} sessions` : 'No session history',
      weight: WEIGHTS.attendance_rate,
      value: f4.sample,
      normalized_score: f4.value,
    },
    {
      name: 'cadence_consistency',
      label: f5.sample >= 3 ? `Consistency over ${f5.sample} intervals` : 'Insufficient session history',
      weight: WEIGHTS.cadence_consistency,
      value: f5.sample,
      normalized_score: f5.value,
    },
    {
      name: 'days_since_last',
      label: f6.days >= 0 ? `Last meaningful interaction ${f6.days}d ago` : 'No interactions on file',
      weight: WEIGHTS.days_since_last,
      value: f6.days,
      normalized_score: f6.value,
    },
    {
      name: 'assessment_completion',
      label: `${f7.in_90d} assessments completed in last 90 days`,
      weight: WEIGHTS.assessment_completion,
      value: f7.in_90d,
      normalized_score: f7.value,
    },
  ]

  // Special case: if there are no signals at all, return 0.5 (neutral).
  if (signals.length === 0) {
    return {
      score: 0.5,
      factors: {
        contributions,
        formula_version: ENGAGEMENT_MODEL_VERSION,
        summary: 'No signal history yet — neutral score',
      },
    }
  }

  let score = 0
  for (const c of contributions) score += c.weight * c.normalized_score
  score = clamp01(score)

  return {
    score: Number(score.toFixed(3)),
    factors: {
      contributions,
      formula_version: ENGAGEMENT_MODEL_VERSION,
      summary: summarizeContributions(contributions),
    },
  }
}
