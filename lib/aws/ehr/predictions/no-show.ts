// lib/aws/ehr/predictions/no-show.ts
//
// W45 T3 — no-show prediction heuristic v1.
//
// Pure read off ehr_patient_signals + the appointments row itself.
// Documented in docs/no-show-prediction-v1.md so therapists can
// understand WHY a patient is flagged.
//
// Output is a calibrated 0..1 score where higher = more likely to
// no-show. Each contributing factor stores its weight, raw value, and
// normalized 0..1 sub-score in factors.contributions so the UI can
// surface "top 3 reasons" without re-deriving them.
//
// Wave 46+ swaps this for a gradient-boosted model trained on the
// labels these heuristics produced; the function signature stays the
// same so the cron + appointment-create caller don't change.

import { pool } from '@/lib/aws/db'
import { clamp01, summarizeContributions, type PredictionFactor, type PredictionFactors } from './types'

export const NO_SHOW_MODEL_VERSION = 'no_show.heuristic.v1'

const WEIGHTS = {
  historical_no_show_rate: 0.25,
  days_since_last_no_show: 0.10,
  reminder_response_rate:  0.15,
  balance_aged:            0.10,
  day_of_week_pattern:     0.10,
  time_of_day_pattern:     0.05,
  booking_lead_time:       0.10,
  communication_pref:      0.10,
  retell_call_signals:     0.05,
}

type Signal = { signal_kind: string; observed_at: string; value: any }

async function loadSignals(
  practiceId: string,
  patientId: string,
  windowDays = 365,
): Promise<Signal[]> {
  const { rows } = await pool.query<Signal>(
    `SELECT signal_kind, observed_at::text, value
       FROM ehr_patient_signals
      WHERE practice_id = $1 AND patient_id = $2
        AND observed_at >= NOW() - ($3::int * INTERVAL '1 day')
      ORDER BY observed_at DESC
      LIMIT 500`,
    [practiceId, patientId, windowDays],
  )
  return rows
}

async function loadAppointment(appointmentId: string): Promise<{
  scheduled_for: Date
  created_at: Date
  duration_minutes: number
  appointment_type: string | null
} | null> {
  const { rows } = await pool.query(
    `SELECT scheduled_for, created_at, duration_minutes, appointment_type
       FROM appointments WHERE id = $1 LIMIT 1`,
    [appointmentId],
  )
  if (rows.length === 0) return null
  return {
    scheduled_for: new Date(rows[0].scheduled_for),
    created_at: new Date(rows[0].created_at),
    duration_minutes: Number(rows[0].duration_minutes),
    appointment_type: rows[0].appointment_type,
  }
}

/** Exponential recency decay. event 0 days ago = weight 1.0; 90 days ago = ~0.5. */
function decay(daysAgo: number, halfLifeDays = 90): number {
  return Math.pow(0.5, daysAgo / halfLifeDays)
}

function daysAgo(when: string | Date): number {
  const d = typeof when === 'string' ? new Date(when) : when
  return (Date.now() - d.getTime()) / 86_400_000
}

// ---- contribution calculators ---------------------------------------

function historicalNoShowRate(signals: Signal[]): { value: number; sample: number } {
  let weightedKept = 0
  let weightedNoShow = 0
  for (const s of signals) {
    if (s.signal_kind === 'appointment_kept' || s.signal_kind === 'appointment_no_show' || s.signal_kind === 'appointment_late_cancel') {
      const w = decay(daysAgo(s.observed_at))
      if (s.signal_kind === 'appointment_no_show') weightedNoShow += w
      else if (s.signal_kind === 'appointment_late_cancel') weightedNoShow += 0.5 * w
      else weightedKept += w
    }
  }
  const total = weightedKept + weightedNoShow
  if (total === 0) return { value: 0.05, sample: 0 } // unknown — assume baseline 5%
  return { value: weightedNoShow / total, sample: total }
}

function daysSinceLastNoShow(signals: Signal[]): { value: number; days: number | null } {
  const ns = signals.find((s) => s.signal_kind === 'appointment_no_show')
  if (!ns) return { value: 0, days: null }
  const days = daysAgo(ns.observed_at)
  // Recent no-show is a strong signal; decay over 60 days.
  const sub = clamp01(1 - days / 60)
  return { value: sub, days: Math.round(days) }
}

function reminderResponseRate(signals: Signal[]): { value: number; sample: number } {
  let sent = 0
  let confirmed = 0
  for (const s of signals) {
    if (s.signal_kind === 'reminder_sent') sent++
    if (s.signal_kind === 'reminder_response') confirmed++
  }
  if (sent === 0) return { value: 0.5, sample: 0 } // unknown
  // High response rate = LOW no-show contribution. Invert.
  return { value: 1 - clamp01(confirmed / sent), sample: sent }
}

function balanceAgedContribution(signals: Signal[]): { value: number; balance_cents: number } {
  // Use the most recent balance_aged signal; older ones are stale (cron
  // emits one per day per outstanding invoice).
  let maxAged = 0
  let totalBalance = 0
  for (const s of signals) {
    if (s.signal_kind !== 'balance_aged') continue
    const v = s.value || {}
    const aged = Number(v.days_aged || 0)
    const bal = Number(v.balance_cents || 0)
    if (aged > maxAged) maxAged = aged
    totalBalance += bal
  }
  if (maxAged === 0) return { value: 0, balance_cents: 0 }
  // Aging from 14 → 90 days maps linearly to 0 → 1.
  const sub = clamp01((maxAged - 14) / (90 - 14))
  return { value: sub, balance_cents: totalBalance }
}

function dayOfWeekPattern(signals: Signal[], scheduledFor: Date): { value: number; details: string } {
  const targetDow = scheduledFor.getUTCDay()
  let sameDayKept = 0, sameDayNoShow = 0
  for (const s of signals) {
    if (s.signal_kind !== 'appointment_kept' && s.signal_kind !== 'appointment_no_show') continue
    const dow = new Date(s.observed_at).getUTCDay()
    if (dow === targetDow) {
      if (s.signal_kind === 'appointment_no_show') sameDayNoShow++
      else sameDayKept++
    }
  }
  const total = sameDayKept + sameDayNoShow
  if (total < 3) return { value: 0, details: 'insufficient_history' }
  const rate = sameDayNoShow / total
  return { value: clamp01(rate), details: `${sameDayNoShow}/${total} on this weekday` }
}

function timeOfDayPattern(signals: Signal[], scheduledFor: Date): { value: number; details: string } {
  const targetHour = scheduledFor.getUTCHours()
  let sameHourKept = 0, sameHourNoShow = 0
  for (const s of signals) {
    if (s.signal_kind !== 'appointment_kept' && s.signal_kind !== 'appointment_no_show') continue
    const h = new Date(s.observed_at).getUTCHours()
    // 2h bucket either side
    if (Math.abs(h - targetHour) <= 1) {
      if (s.signal_kind === 'appointment_no_show') sameHourNoShow++
      else sameHourKept++
    }
  }
  const total = sameHourKept + sameHourNoShow
  if (total < 3) return { value: 0, details: 'insufficient_history' }
  return { value: clamp01(sameHourNoShow / total), details: `${sameHourNoShow}/${total} near this hour` }
}

function bookingLeadTime(scheduledFor: Date, createdAt: Date): { value: number; days: number } {
  const leadDays = (scheduledFor.getTime() - createdAt.getTime()) / 86_400_000
  // Sweet spot 3-14 days. Same-day or far-out (>30d) bookings are
  // higher risk. U-shape clamped to 0..1.
  if (leadDays >= 3 && leadDays <= 14) return { value: 0, days: Math.round(leadDays) }
  if (leadDays < 3) return { value: clamp01((3 - leadDays) / 3 * 0.6), days: Math.round(leadDays) }
  return { value: clamp01((leadDays - 14) / 60 * 0.6), days: Math.round(leadDays) }
}

function communicationPrefSignal(signals: Signal[]): { value: number; pref: string | null } {
  // If a comm preference change was recent, treat as engagement signal
  // (changing preferences = paying attention). Otherwise neutral.
  const change = signals.find((s) => s.signal_kind === 'communication_preference_changed')
  if (change && daysAgo(change.observed_at) < 30) {
    const pref = String((change.value || {}).communication_preference || '')
    return { value: 0, pref } // recent change = engaged
  }
  return { value: 0.05, pref: null } // tiny baseline contribution
}

function retellCallSignals(signals: Signal[]): { value: number; details: string } {
  const calls = signals.filter((s) => s.signal_kind === 'call_received' && daysAgo(s.observed_at) < 30)
  if (calls.length === 0) return { value: 0, details: 'no_calls' }
  // Look for intent_to_cancel hints in call value payloads.
  let hesitation = 0
  for (const c of calls) {
    const v = c.value || {}
    if (v.intent_to_cancel === true) hesitation += 0.5
    if (typeof v.hesitation_score === 'number') hesitation += clamp01(v.hesitation_score) * 0.3
  }
  if (hesitation === 0) return { value: 0, details: 'no_hesitation_markers' }
  return { value: clamp01(hesitation), details: `${calls.length} calls, hesitation ${hesitation.toFixed(2)}` }
}

// ---- main entry -----------------------------------------------------

export async function computeNoShow(
  practiceId: string,
  patientId: string,
  appointmentId: string,
): Promise<{ score: number; factors: PredictionFactors }> {
  const appt = await loadAppointment(appointmentId)
  if (!appt) {
    return {
      score: 0,
      factors: {
        contributions: [],
        formula_version: NO_SHOW_MODEL_VERSION,
        summary: 'Appointment not found',
      },
    }
  }

  const signals = await loadSignals(practiceId, patientId, 365)

  const f1 = historicalNoShowRate(signals)
  const f2 = daysSinceLastNoShow(signals)
  const f3 = reminderResponseRate(signals)
  const f4 = balanceAgedContribution(signals)
  const f5 = dayOfWeekPattern(signals, appt.scheduled_for)
  const f6 = timeOfDayPattern(signals, appt.scheduled_for)
  const f7 = bookingLeadTime(appt.scheduled_for, appt.created_at)
  const f8 = communicationPrefSignal(signals)
  const f9 = retellCallSignals(signals)

  const contributions: PredictionFactor[] = [
    {
      name: 'historical_no_show_rate',
      label: `Historical no-show rate (${f1.sample.toFixed(1)} sessions weighted)`,
      weight: WEIGHTS.historical_no_show_rate,
      value: Number(f1.value.toFixed(3)),
      normalized_score: f1.value,
    },
    {
      name: 'days_since_last_no_show',
      label: f2.days != null ? `Last no-show ${f2.days} days ago` : 'No no-shows on record',
      weight: WEIGHTS.days_since_last_no_show,
      value: f2.days,
      normalized_score: f2.value,
    },
    {
      name: 'reminder_response_rate',
      label: `Reminder confirmation rate (${f3.sample} sent)`,
      weight: WEIGHTS.reminder_response_rate,
      value: Number((1 - f3.value).toFixed(3)),
      normalized_score: f3.value,
    },
    {
      name: 'balance_aged',
      label: f4.balance_cents > 0
        ? `Outstanding balance $${(f4.balance_cents / 100).toFixed(2)}`
        : 'No outstanding balance',
      weight: WEIGHTS.balance_aged,
      value: f4.balance_cents,
      normalized_score: f4.value,
    },
    {
      name: 'day_of_week_pattern',
      label: `Day-of-week pattern: ${f5.details}`,
      weight: WEIGHTS.day_of_week_pattern,
      value: f5.details,
      normalized_score: f5.value,
    },
    {
      name: 'time_of_day_pattern',
      label: `Time-of-day pattern: ${f6.details}`,
      weight: WEIGHTS.time_of_day_pattern,
      value: f6.details,
      normalized_score: f6.value,
    },
    {
      name: 'booking_lead_time',
      label: `Booked ${f7.days} days in advance`,
      weight: WEIGHTS.booking_lead_time,
      value: f7.days,
      normalized_score: f7.value,
    },
    {
      name: 'communication_pref',
      label: f8.pref ? `Recent preference change → ${f8.pref}` : 'Stable communication preference',
      weight: WEIGHTS.communication_pref,
      value: f8.pref,
      normalized_score: f8.value,
    },
    {
      name: 'retell_call_signals',
      label: `Recent call signals: ${f9.details}`,
      weight: WEIGHTS.retell_call_signals,
      value: f9.details,
      normalized_score: f9.value,
    },
  ]

  let score = 0
  for (const c of contributions) score += c.weight * c.normalized_score
  score = clamp01(score)

  return {
    score: Number(score.toFixed(3)),
    factors: {
      contributions,
      formula_version: NO_SHOW_MODEL_VERSION,
      summary: summarizeContributions(contributions),
    },
  }
}
