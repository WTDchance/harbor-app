// lib/ehr/credentialing.ts
//
// W49 D3 — shared helpers for the four credential resources.

export const LICENSE_STATUSES = ['active', 'expired', 'suspended', 'inactive'] as const
export type LicenseStatus = typeof LICENSE_STATUSES[number]

export const ENROLLMENT_STATUSES = ['pending', 'enrolled', 'denied', 'terminated'] as const
export type EnrollmentStatus = typeof ENROLLMENT_STATUSES[number]

export const EXPIRY_THRESHOLDS = [60, 30, 7] as const

export function daysUntil(d: string | Date | null): number | null {
  if (!d) return null
  const target = (typeof d === 'string' ? new Date(d) : d).getTime()
  if (isNaN(target)) return null
  return Math.ceil((target - Date.now()) / (24 * 3600 * 1000))
}

export function pickThresholdToFire(prevThreshold: number | null, daysLeft: number): number | null {
  // Find the largest threshold that days_left has crossed and that is
  // strictly smaller than the previously fired warning. Returns null
  // if no new threshold should fire.
  for (const t of EXPIRY_THRESHOLDS) {
    if (daysLeft <= t && (prevThreshold === null || prevThreshold > t)) return t
  }
  return null
}

export function isValidUSState(s: string): boolean {
  return /^[A-Z]{2}$/.test(s)
}

export function normaliseState(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const v = s.trim().toUpperCase()
  return isValidUSState(v) ? v : null
}

/**
 * Sum of CE hours, optionally filtered by completed_at >= cutoff.
 */
export function totalCeHours(rows: Array<{ hours: number | string }>): number {
  return rows.reduce((acc, r) => acc + Number(r.hours || 0), 0)
}
