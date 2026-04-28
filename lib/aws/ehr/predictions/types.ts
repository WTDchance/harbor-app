// lib/aws/ehr/predictions/types.ts
//
// W45 — shared types for the heuristic prediction layer. ML models in
// W46+ produce the same shapes so the surfacing UI doesn't change.

export type PredictionKind =
  | 'no_show'
  | 'reschedule_willingness'
  | 'engagement_score'
  | 'dropout_risk'

export type PredictionFactor = {
  /** Stable identifier ('historical_no_show_rate', 'days_since_last_no_show', etc.). */
  name: string
  /** User-facing description ("Historical no-show rate over last 12 sessions"). */
  label?: string
  /** Per-input weight in the formula (0..1). Sum of weights ~= 1. */
  weight: number
  /** Raw input value as observed from signals. Stringified for display. */
  value: string | number | null
  /** Per-input contribution to the final score (0..1). */
  normalized_score: number
}

export type PredictionFactors = {
  contributions: PredictionFactor[]
  formula_version: string
  /** Short therapist-facing summary of the top contributors. */
  summary: string
}

export type PredictionResult = {
  practice_id: string
  patient_id: string
  appointment_id?: string | null
  kind: PredictionKind
  score: number
  factors: PredictionFactors
  model_version: string
}

/** Clamp a number into [0, 1]. */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

/** Build a one-line human summary from the top three contributing factors. */
export function summarizeContributions(contribs: PredictionFactor[]): string {
  const top = [...contribs]
    .sort((a, b) => Math.abs(b.normalized_score * b.weight) - Math.abs(a.normalized_score * a.weight))
    .slice(0, 3)
  if (top.length === 0) return 'No driver signals'
  return top.map((c) => c.label || c.name).join(' · ')
}
