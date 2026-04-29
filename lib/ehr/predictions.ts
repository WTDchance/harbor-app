// lib/ehr/predictions.ts
//
// W50 D3 — heuristic prediction layer over the rolling
// ehr_patient_signal_aggregate row. Pure functions — no DB I/O — so
// the cron + tests can call without setup.

import { createHash } from 'node:crypto'

export interface PatientFeatures {
  recent_no_show_count: number
  consecutive_kept: number
  last_call_hesitation_score: number | null    // 0..1
  last_sentiment: number | null                // -1..1
  appointments_kept: number
  appointments_no_show: number
  appointments_cancelled: number
  payments_on_time: number
  payments_late: number
  current_balance_cents: number
  has_no_call_no_show_in_last_30d: boolean
  no_appointment_in_last_60d: boolean
}

export interface PatientPrediction {
  no_show_prob: number       // 0..1
  dropout_prob: number       // 0..1
  payment_risk_score: number // 0..1
  churn_score: number        // 0..1
  composite_severity: 'low' | 'medium' | 'high'
  factors: Record<string, unknown>
  model_version: string
  inputs_hash: string
}

const MODEL_VERSION = 'v2-heuristic-1'

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export function computeNoShowProb(f: PatientFeatures): number {
  const base = 0.10
  const recent = f.recent_no_show_count * 0.15
  const hes = (f.last_call_hesitation_score ?? 0) * 0.20
  const offset = f.consecutive_kept * 0.05
  return clamp01(base + recent + hes - offset)
}

export function computeDropoutProb(f: PatientFeatures): number {
  const base = 0.05
  const ncns = f.has_no_call_no_show_in_last_30d ? 0.30 : 0
  const negSent = (f.last_sentiment ?? 0) < 0 ? 0.20 : 0
  const stale = f.no_appointment_in_last_60d ? 0.40 : 0
  return clamp01(base + ncns + negSent + stale)
}

export function computePaymentRiskScore(f: PatientFeatures): number {
  const totalPayments = f.payments_on_time + f.payments_late
  const lateRatio = totalPayments > 0 ? f.payments_late / totalPayments : 0
  const balanceFactor = f.current_balance_cents > 200 * 100 ? 0.4 : 0
  return clamp01(lateRatio * 0.6 + balanceFactor)
}

export function computeChurnScore(dropoutProb: number, paymentRiskScore: number, sentiment: number | null): number {
  const sentimentFactor = sentiment === null ? 0 : (1 - (sentiment + 1) / 2) // -1..1 → 0..1 (1 = most negative)
  return clamp01(Math.max(dropoutProb, paymentRiskScore) * 0.7 + sentimentFactor * 0.3)
}

export function severityFor(score: number): 'low' | 'medium' | 'high' {
  if (score >= 0.7) return 'high'
  if (score >= 0.4) return 'medium'
  return 'low'
}

export function hashFeatures(f: PatientFeatures): string {
  const h = createHash('sha256')
  h.update(JSON.stringify({
    nsc: f.recent_no_show_count,
    ck: f.consecutive_kept,
    lch: f.last_call_hesitation_score,
    ls: f.last_sentiment,
    ak: f.appointments_kept, ans: f.appointments_no_show, ac: f.appointments_cancelled,
    pot: f.payments_on_time, pl: f.payments_late, bal: f.current_balance_cents,
    ncns: f.has_no_call_no_show_in_last_30d, na60: f.no_appointment_in_last_60d,
    v: MODEL_VERSION,
  }))
  return h.digest('hex').slice(0, 32)
}

export function predict(f: PatientFeatures): PatientPrediction {
  const no_show_prob = computeNoShowProb(f)
  const dropout_prob = computeDropoutProb(f)
  const payment_risk_score = computePaymentRiskScore(f)
  const churn_score = computeChurnScore(dropout_prob, payment_risk_score, f.last_sentiment)
  const composite = Math.max(no_show_prob, dropout_prob, payment_risk_score, churn_score)

  return {
    no_show_prob,
    dropout_prob,
    payment_risk_score,
    churn_score,
    composite_severity: severityFor(composite),
    factors: {
      recent_no_show_count: f.recent_no_show_count,
      consecutive_kept: f.consecutive_kept,
      late_payment_ratio: (f.payments_on_time + f.payments_late) > 0
        ? f.payments_late / (f.payments_on_time + f.payments_late) : null,
      current_balance_cents: f.current_balance_cents,
      sentiment: f.last_sentiment,
      hesitation: f.last_call_hesitation_score,
      stale_60d: f.no_appointment_in_last_60d,
      ncns_30d: f.has_no_call_no_show_in_last_30d,
    },
    model_version: MODEL_VERSION,
    inputs_hash: hashFeatures(f),
  }
}
