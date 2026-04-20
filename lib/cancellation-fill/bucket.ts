/**
 * Cancellation Fill — Bucket computation
 *
 * Pure functions. No I/O. No side effects.
 * Classifies a slot's time-to-start into one of four fill windows.
 *
 * Bucket boundaries match docs/cancellation-policy.md:
 *   24plus   → ≥ 24 hours lead time
 *   8_to_24  → ≥ 8  and < 24 hours
 *   2_to_8   → ≥ 2  and <  8 hours
 *   sub_1    → <  1 hour (between 1 and 2 hours falls to 2_to_8 by design)
 *
 * The gap between 1 and 2 hours deliberately rounds DOWN into 2_to_8 —
 * anything with <2hr lead time that's still "last-minute opt-in" territory.
 * Anything truly sub-1-hr triggers the shift-earlier / accept-loss path.
 */

import type { FillBucket } from './types'

export const MS_PER_HOUR = 60 * 60 * 1000

/**
 * Classify a slot start time vs. current time into a fill bucket.
 *
 * If the slot is already in the past (leadMs < 0), we return 'sub_1' as a
 * degenerate case — the caller should detect this via `isSlotInPast()` and
 * short-circuit before dispatch.
 */
export function computeBucket(slotStart: Date, now: Date = new Date()): FillBucket {
  const leadMs = slotStart.getTime() - now.getTime()
  const leadHours = leadMs / MS_PER_HOUR

  if (leadHours >= 24) return '24plus'
  if (leadHours >= 8) return '8_to_24'
  if (leadHours >= 2) return '2_to_8'
  return 'sub_1'
}

/** True if the slot is at or before "now". */
export function isSlotInPast(slotStart: Date, now: Date = new Date()): boolean {
  return slotStart.getTime() <= now.getTime()
}

/** Lead time in hours, signed. Negative if slot is past. */
export function leadTimeHours(slotStart: Date, now: Date = new Date()): number {
  return (slotStart.getTime() - now.getTime()) / MS_PER_HOUR
}

/** For logging: human-readable lead-time label. */
export function formatLeadTime(hours: number): string {
  if (hours < 0) return `${Math.abs(hours).toFixed(1)}h ago`
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)}d`
}
