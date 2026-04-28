// lib/aws/ehr/predictions/reschedule.ts
//
// W45 T4 — reschedule willingness ranker. Given an open slot (an
// appointment that just cancelled or freed up), rank a practice's
// active patients by likelihood to accept an offer to take the slot.
//
// Pure read off ehr_patient_signals + ehr_patient_predictions
// (engagement score from T5).

import { pool } from '@/lib/aws/db'
import { clamp01, summarizeContributions, type PredictionFactor, type PredictionFactors } from './types'

export const RESCHEDULE_MODEL_VERSION = 'reschedule.heuristic.v1'

const WEIGHTS = {
  historical_accept_rate:  0.30,
  reminder_response_speed: 0.15,
  prior_offer_response:    0.20,
  slot_timing_alignment:   0.15,
  engagement_score:        0.20,
}

type Signal = { signal_kind: string; observed_at: string; value: any }

type Patient = {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
  communication_preference: string | null
}

export type RescheduleCandidate = {
  patient_id: string
  patient_name: string
  phone: string | null
  email: string | null
  communication_preference: string | null
  score: number
  factors: PredictionFactors
}

function daysAgo(when: string | Date): number {
  const d = typeof when === 'string' ? new Date(when) : when
  return (Date.now() - d.getTime()) / 86_400_000
}

async function loadActivePatients(practiceId: string): Promise<Patient[]> {
  const { rows } = await pool.query<Patient>(
    `SELECT DISTINCT p.id, p.first_name, p.last_name, p.phone, p.email,
            p.communication_preference
       FROM patients p
      WHERE p.practice_id = $1
        AND COALESCE(p.patient_status, 'active') <> 'discharged'
        AND EXISTS (
          SELECT 1 FROM appointments a
           WHERE a.patient_id = p.id
             AND a.scheduled_for >= NOW() - INTERVAL '90 days'
        )`,
    [practiceId],
  )
  return rows
}

async function loadSignalsBatch(
  practiceId: string,
  patientIds: string[],
): Promise<Map<string, Signal[]>> {
  if (patientIds.length === 0) return new Map()
  const { rows } = await pool.query<{ patient_id: string } & Signal>(
    `SELECT patient_id::text, signal_kind, observed_at::text, value
       FROM ehr_patient_signals
      WHERE practice_id = $1
        AND patient_id = ANY($2::uuid[])
        AND observed_at >= NOW() - INTERVAL '180 days'
      ORDER BY observed_at DESC`,
    [practiceId, patientIds],
  )
  const out = new Map<string, Signal[]>()
  for (const r of rows) {
    const list = out.get(r.patient_id) || []
    list.push({ signal_kind: r.signal_kind, observed_at: r.observed_at, value: r.value })
    out.set(r.patient_id, list)
  }
  return out
}

async function loadEngagementBatch(
  practiceId: string,
  patientIds: string[],
): Promise<Map<string, number>> {
  if (patientIds.length === 0) return new Map()
  const { rows } = await pool.query<{ patient_id: string; score: string }>(
    `SELECT patient_id::text, score
       FROM ehr_patient_predictions
      WHERE practice_id = $1
        AND prediction_kind = 'engagement_score'
        AND patient_id = ANY($2::uuid[])
        AND appointment_id IS NULL`,
    [practiceId, patientIds],
  )
  return new Map(rows.map((r) => [r.patient_id, Number(r.score)]))
}

// ---- per-patient scoring -------------------------------------------

function historicalAcceptRate(signals: Signal[]): { value: number; sample: number } {
  const accepted = signals.filter((s) => s.signal_kind === 'reschedule_offer_accepted').length
  const declined = signals.filter((s) => s.signal_kind === 'reschedule_offer_declined').length
  const total = accepted + declined
  if (total === 0) return { value: 0.5, sample: 0 } // unknown — neutral
  return { value: clamp01(accepted / total), sample: total }
}

function reminderResponseSpeed(signals: Signal[]): { value: number; sample: number } {
  // Median delta between reminder_sent and reminder_response. Faster
  // = more responsive = more likely to accept.
  const sentByAppt = new Map<string, Date>()
  const responseByAppt = new Map<string, Date>()
  for (const s of signals) {
    const apptId = (s.value || {}).appointment_id
    if (!apptId) continue
    if (s.signal_kind === 'reminder_sent') sentByAppt.set(apptId, new Date(s.observed_at))
    if (s.signal_kind === 'reminder_response') responseByAppt.set(apptId, new Date(s.observed_at))
  }
  const deltas: number[] = []
  for (const [apptId, sent] of sentByAppt) {
    const resp = responseByAppt.get(apptId)
    if (resp) deltas.push((resp.getTime() - sent.getTime()) / 60_000) // minutes
  }
  if (deltas.length === 0) return { value: 0.5, sample: 0 }
  deltas.sort((a, b) => a - b)
  const median = deltas[Math.floor(deltas.length / 2)]
  // <30 min → 1.0; >24h (1440 min) → 0.0; linear in log space.
  if (median <= 30) return { value: 1, sample: deltas.length }
  if (median >= 1440) return { value: 0, sample: deltas.length }
  // Log scale: 30 → 1, 1440 → 0
  const logged = (Math.log(1440) - Math.log(median)) / (Math.log(1440) - Math.log(30))
  return { value: clamp01(logged), sample: deltas.length }
}

function priorOfferResponse(signals: Signal[]): { value: number; sample: number } {
  // Look at the most-recent reschedule_offer_* signal across last 60d.
  const recent = signals.filter(
    (s) => s.signal_kind.startsWith('reschedule_offer_') && daysAgo(s.observed_at) <= 60,
  )
  if (recent.length === 0) return { value: 0.5, sample: 0 }
  const last = recent[0] // ordered DESC by observed_at
  if (last.signal_kind === 'reschedule_offer_accepted') return { value: 1, sample: recent.length }
  if (last.signal_kind === 'reschedule_offer_declined') return { value: 0.2, sample: recent.length }
  // sent but never responded → moderate
  return { value: 0.4, sample: recent.length }
}

function slotTimingAlignment(signals: Signal[], slotTime: Date): { value: number; details: string } {
  const dow = slotTime.getUTCDay()
  const hour = slotTime.getUTCHours()
  let dowMatch = 0
  let hourMatch = 0
  let total = 0
  for (const s of signals) {
    if (s.signal_kind !== 'appointment_kept') continue
    const t = new Date(s.observed_at)
    total++
    if (t.getUTCDay() === dow) dowMatch++
    if (Math.abs(t.getUTCHours() - hour) <= 1) hourMatch++
  }
  if (total < 3) return { value: 0.5, details: 'insufficient_history' }
  const subDow  = dowMatch  / total
  const subHour = hourMatch / total
  const sub = clamp01(0.5 * subDow + 0.5 * subHour)
  return { value: sub, details: `${dowMatch}/${total} same DOW, ${hourMatch}/${total} same hour` }
}

function scorePatient(args: {
  signals: Signal[]
  engagement: number | undefined
  slotTime: Date
}): { score: number; factors: PredictionFactors } {
  const f1 = historicalAcceptRate(args.signals)
  const f2 = reminderResponseSpeed(args.signals)
  const f3 = priorOfferResponse(args.signals)
  const f4 = slotTimingAlignment(args.signals, args.slotTime)
  const eng = typeof args.engagement === 'number' ? args.engagement : 0.5

  const contributions: PredictionFactor[] = [
    {
      name: 'historical_accept_rate',
      label: f1.sample > 0 ? `Past offers: ${f1.sample} accepted/declined` : 'No prior offer history',
      weight: WEIGHTS.historical_accept_rate,
      value: f1.sample,
      normalized_score: f1.value,
    },
    {
      name: 'reminder_response_speed',
      label: f2.sample > 0 ? `Median reminder response time` : 'No reminder history',
      weight: WEIGHTS.reminder_response_speed,
      value: f2.sample,
      normalized_score: f2.value,
    },
    {
      name: 'prior_offer_response',
      label: f3.sample > 0 ? `Recent offer (last 60d)` : 'No recent offers',
      weight: WEIGHTS.prior_offer_response,
      value: f3.sample,
      normalized_score: f3.value,
    },
    {
      name: 'slot_timing_alignment',
      label: f4.details,
      weight: WEIGHTS.slot_timing_alignment,
      value: f4.details,
      normalized_score: f4.value,
    },
    {
      name: 'engagement_score',
      label: `Engagement: ${(eng * 100).toFixed(0)}%`,
      weight: WEIGHTS.engagement_score,
      value: eng,
      normalized_score: eng,
    },
  ]

  let score = 0
  for (const c of contributions) score += c.weight * c.normalized_score
  score = clamp01(score)

  return {
    score: Number(score.toFixed(3)),
    factors: {
      contributions,
      formula_version: RESCHEDULE_MODEL_VERSION,
      summary: summarizeContributions(contributions),
    },
  }
}

// ---- main entry -----------------------------------------------------

export async function rankRescheduleCandidates(args: {
  practiceId: string
  slotTime: Date
  excludePatientIds?: string[]
  topN?: number
}): Promise<RescheduleCandidate[]> {
  const patients = await loadActivePatients(args.practiceId)
  const exclude = new Set(args.excludePatientIds || [])
  const eligible = patients.filter((p) => !exclude.has(p.id))
  if (eligible.length === 0) return []

  const ids = eligible.map((p) => p.id)
  const [signalsByPatient, engagementByPatient] = await Promise.all([
    loadSignalsBatch(args.practiceId, ids),
    loadEngagementBatch(args.practiceId, ids),
  ])

  const ranked: RescheduleCandidate[] = eligible.map((p) => {
    const result = scorePatient({
      signals: signalsByPatient.get(p.id) || [],
      engagement: engagementByPatient.get(p.id),
      slotTime: args.slotTime,
    })
    return {
      patient_id: p.id,
      patient_name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || '—',
      phone: p.phone,
      email: p.email,
      communication_preference: p.communication_preference,
      score: result.score,
      factors: result.factors,
    }
  })

  ranked.sort((a, b) => b.score - a.score)
  return ranked.slice(0, args.topN ?? 25)
}
