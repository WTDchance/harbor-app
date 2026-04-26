// Cancellation Fill — Exclusion gates (AWS port).
//
// EVERY function in this file enforces a rule from
// docs/cancellation-fill-ethics.md. See the section comments for the map.
//
// AWS canonical schema notes:
//   crisis_alerts.created_at replaces the legacy triggered_at column.
//   crisis_alerts has no patient_phone column on AWS canonical — the
//     per-candidate phone-keyed crisis check therefore matches by
//     patient_id when the candidate's id is known. Waitlist entries
//     don't carry patient_id, so per-candidate crisis checks for waitlist
//     fall through to the practice-wide gate (which already covers them).

import { pool } from '@/lib/aws/db'
import { isSmsOptedOut } from '@/lib/aws/sms-optout'
import { isEmailOptedOut } from '@/lib/email-optout'
import type {
  CancellationFillSettings,
  CandidatePatient,
  CandidateWaitlistEntry,
  HardBlockReason,
  CandidateBlockReason,
} from './types'

// ---------------------------------------------------------------------------
// PRACTICE-LEVEL HARD BLOCKS
// ---------------------------------------------------------------------------

/**
 * §1 — Crisis lookback at PRACTICE level. Fail-closed on error.
 */
export async function hasRecentCrisisAtPractice(
  practiceId: string,
  settings: CancellationFillSettings,
): Promise<boolean> {
  const sinceMs = Date.now() - settings.crisis_lookback_days * 86_400_000
  const since = new Date(sinceMs).toISOString()
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM crisis_alerts
        WHERE practice_id = $1 AND created_at >= $2
        LIMIT 1`,
      [practiceId, since],
    )
    return rows.length > 0
  } catch (err) {
    console.warn('[exclusions] crisis check failed; failing closed', (err as Error).message)
    return true
  }
}

// ---------------------------------------------------------------------------
// PER-CANDIDATE FILTERS
// ---------------------------------------------------------------------------

/** §2 — SMS opt-out is absolute. */
export async function isCandidateSmsOptedOut(
  practiceId: string,
  phone: string | null | undefined,
): Promise<boolean> {
  if (!phone) return false
  try {
    return await isSmsOptedOut(practiceId, phone)
  } catch (e) {
    console.warn('[exclusions] SMS opt-out check errored; failing closed', e)
    return true
  }
}

/** §2 — Email opt-out is absolute. */
export async function isCandidateEmailOptedOut(
  practiceId: string,
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false
  try {
    return await isEmailOptedOut(practiceId, email)
  } catch (e) {
    console.warn('[exclusions] email opt-out check errored; failing closed', e)
    return true
  }
}

/**
 * §1 — Per-patient crisis check (AWS variant — keyed on patient_id since
 * the canonical crisis_alerts schema has no patient_phone column). Returns
 * false when no patient_id is provided, since waitlist entries can't be
 * matched this way.
 */
export async function isPatientInCrisisLookback(
  practiceId: string,
  patientId: string | null | undefined,
  settings: CancellationFillSettings,
): Promise<boolean> {
  if (!patientId) return false
  const since = new Date(
    Date.now() - settings.crisis_lookback_days * 86_400_000,
  ).toISOString()
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM crisis_alerts
        WHERE practice_id = $1 AND patient_id = $2 AND created_at >= $3
        LIMIT 1`,
      [practiceId, patientId, since],
    )
    return rows.length > 0
  } catch (err) {
    console.warn('[exclusions] patient crisis check failed; failing closed', (err as Error).message)
    return true
  }
}

/**
 * §5 — New patients require therapist review. Schema gap: AWS canonical
 * patients table doesn't carry intake_completed or total_appointments. We
 * treat the absence of those fields as "candidate is non-new" until the
 * Supabase columns get migrated over — observational mode in AWS is
 * therefore MORE permissive than legacy on this gate. TODO: extend the
 * patients schema or compute total_appointments on-the-fly.
 */
export function newPatientRequiresReview(patient: CandidatePatient): boolean {
  if (patient.intake_completed === false) return true
  if (patient.total_appointments != null && patient.total_appointments < 1) return true
  return false
}

/** Soft limit A — No-show pattern. Schema-gap-aware: if no_show_count is
 *  null we treat it as 0. */
export function hasRecentNoShowPattern(
  patient: CandidatePatient,
  settings: CancellationFillSettings,
): boolean {
  return (patient.no_show_count ?? 0) >= settings.no_show_threshold
}

/** Intake-incomplete gate. Schema-gap-aware as above. */
export function hasIncompleteIntake(patient: CandidatePatient): boolean {
  return patient.intake_completed === false
}

/**
 * §4 — Therapeutic continuity. AWS-side check uses therapists.is_active
 * count to detect multi-therapist practices. Same stricter interpretation
 * as legacy: when we cannot prove same-therapist continuity, we block.
 */
export async function wouldBreakTherapistContinuity(
  practiceId: string,
  _candidatePatientId: string,
): Promise<boolean> {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM therapists
        WHERE practice_id = $1 AND is_active = true`,
      [practiceId],
    )
    const therapistCount = rows[0]?.c ?? 0
    if (therapistCount <= 1) return false // solo practice → trivially continuous
    return true // multi-therapist + no assignment data → block
  } catch (err) {
    console.warn('[exclusions] therapist count failed; failing closed', (err as Error).message)
    return true
  }
}

/** Soft limit C — placeholder, returns false in observational mode. */
export function preferredTimesMismatch(
  _patient: CandidatePatient | CandidateWaitlistEntry,
  _slotStart: Date,
): boolean {
  return false
}

// ---------------------------------------------------------------------------
// PRACTICE-LEVEL AGGREGATOR
// ---------------------------------------------------------------------------

export async function checkHardBlocks(
  practiceId: string,
  settings: CancellationFillSettings,
  slotStart: Date,
): Promise<HardBlockReason | null> {
  if (!settings.dispatcher_enabled) return 'dispatcher_disabled'
  if (slotStart.getTime() <= Date.now()) return 'slot_in_past'
  if (await hasRecentCrisisAtPractice(practiceId, settings)) return 'crisis_in_lookback'
  return null
}

// ---------------------------------------------------------------------------
// Convenience aggregator — run all per-candidate filters, return first reason
// ---------------------------------------------------------------------------

export interface CandidateContext {
  practiceId: string
  settings: CancellationFillSettings
  slotStart: Date
}

export async function evaluatePatientCandidate(
  ctx: CandidateContext,
  patient: CandidatePatient,
): Promise<CandidateBlockReason | null> {
  if (patient.phone && (await isCandidateSmsOptedOut(ctx.practiceId, patient.phone))) {
    return 'sms_opted_out'
  }
  if (patient.email && (await isCandidateEmailOptedOut(ctx.practiceId, patient.email))) {
    return 'email_opted_out'
  }
  if (await isPatientInCrisisLookback(ctx.practiceId, patient.id, ctx.settings)) {
    return 'patient_in_crisis'
  }
  if (await wouldBreakTherapistContinuity(ctx.practiceId, patient.id)) {
    return 'different_therapist'
  }
  if (hasIncompleteIntake(patient)) return 'intake_incomplete'
  if (hasRecentNoShowPattern(patient, ctx.settings)) return 'no_show_pattern'
  if (newPatientRequiresReview(patient)) return 'new_patient_requires_review'
  if (preferredTimesMismatch(patient, ctx.slotStart)) return 'preferred_times_mismatch'
  return null
}

export async function evaluateWaitlistCandidate(
  ctx: CandidateContext,
  entry: CandidateWaitlistEntry,
): Promise<CandidateBlockReason | null> {
  if (
    entry.patient_phone &&
    (await isCandidateSmsOptedOut(ctx.practiceId, entry.patient_phone))
  ) {
    return 'sms_opted_out'
  }
  if (
    entry.patient_email &&
    (await isCandidateEmailOptedOut(ctx.practiceId, entry.patient_email))
  ) {
    return 'email_opted_out'
  }
  // Waitlist entries don't carry patient_id, so the per-candidate crisis
  // check is N/A on AWS canonical. The practice-wide gate
  // (hasRecentCrisisAtPractice) already blocked dispatch if any crisis
  // alert was recent, so waitlist evaluation never reaches this branch
  // when there's an active crisis. Soft pass.
  if (preferredTimesMismatch(entry, ctx.slotStart)) return 'preferred_times_mismatch'
  return null
}
