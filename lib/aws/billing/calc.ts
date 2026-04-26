// lib/aws/billing/calc.ts
//
// Wave 22 — Pure billing helpers (no Supabase, no DB). Split out of
// lib/ehr/billing.ts so the AWS-ported routes (Wave 15 superbill,
// Wave 22 patient-summary, future Wave 24 eligibility) can import
// these without dragging in supabaseAdmin via module load.

/**
 * Fallback fee schedule (in cents) for CPT codes. Used when a practice
 * hasn't configured its own. Midpoint community rates that won't
 * embarrass anyone but should be overridden per-practice via
 * practices.default_fee_schedule_cents.
 */
export const DEFAULT_FEE_CENTS: Record<string, number> = {
  '90791': 20000, // intake
  '90792': 22500, // intake w/ medical
  '90832': 10000, // 30-min psychotherapy
  '90834': 15000, // 45-min
  '90837': 18000, // 60-min
  '90838': 15500, // 60-min add-on
  '90846': 15000, // family without patient
  '90847': 17500, // family with patient
  '90853': 7500,  // group
  '90839': 22000, // crisis first 60
  '90840': 12500, // crisis add-on 30
  '90785': 2500,  // interactive complexity add-on
  '96127': 3000,  // brief assessment
  '99354': 15000, // prolonged service add-on
}

export type BilledTo = 'insurance' | 'patient_self_pay' | 'both'

/** Pull the fee-cents for a CPT, preferring practice override. */
export function feeForCpt(
  cpt: string,
  practiceFeeSchedule: Record<string, number> | null | undefined,
): number {
  if (practiceFeeSchedule && typeof practiceFeeSchedule[cpt] === 'number') {
    return practiceFeeSchedule[cpt]
  }
  return DEFAULT_FEE_CENTS[cpt] ?? 15000
}

export function centsToDollars(c: number | null | undefined): string {
  if (c == null) return '$0.00'
  const sign = c < 0 ? '-' : ''
  const abs = Math.abs(c)
  return `${sign}$${(abs / 100).toFixed(2)}`
}

export function dollarsToCents(s: string | number | null | undefined): number {
  if (s == null) return 0
  const n = typeof s === 'number' ? s : parseFloat(String(s).replace(/[^0-9.\-]/g, ''))
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}
