/**
 * Cancellation Fill — Exclusion gates
 *
 * EVERY function in this file enforces a rule from docs/cancellation-fill-ethics.md.
 * Each export has a comment naming the exact section it implements.
 *
 * Two layers:
 *   1. PRACTICE-LEVEL HARD BLOCKS — evaluated once before any candidate work.
 *      If any returns true, dispatch refuses entirely (hardBlock reason).
 *
 *   2. PER-CANDIDATE FILTERS — each candidate is run through these. Failing
 *      candidates are skipped with a recorded CandidateBlockReason. The
 *      dispatch continues with other candidates.
 *
 * Ethics doc sections:
 *   §1  Crisis-connected patients never auto-offered
 *   §2  Opt-out flags absolute
 *   §3  No PHI leak in offer messages (enforced in message-builder, not here)
 *   §4  Therapeutic continuity preserved
 *   §5  Identity verification for new patients
 *   §6  Honest closure for parallel offer recipients (post-claim messaging)
 *   §7  No discrimination by proxy in scoring (enforced in scoring.ts)
 *   §8  No dark patterns in offer language (enforced in message-builder)
 *   §9  Late-cancel fees recorded, never auto-charged (enforced in confirm route)
 *   §10 Data retention minimum-necessary (enforced by table schema)
 *
 * Soft guidelines (strongly recommended, configurable):
 *   A   Cap no-show-pattern exclusion at 2 months
 *   B   Prefer existing patients over new (scoring)
 *   C   Respect explicit preferred-times constraints
 */

import { supabaseAdmin } from '@/lib/supabase'
import { isOptedOut } from '@/lib/sms-optout'
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
 * §1 — Crisis lookback at PRACTICE level.
 *
 * If ANY patient in the practice has a crisis alert within the lookback,
 * we do not auto-fill this slot — the surface brings it to the therapist.
 *
 * Rationale: during an active crisis period, filling cancellations
 * automatically competes for the therapist's attention with a clinically
 * fragile case. Better to put the whole queue under human review.
 *
 * This intentionally blocks auto-fill for the WHOLE slot, not just one
 * candidate. Per §1, crisis-connected patients are the specific people we
 * must not auto-offer — but because crisis_alerts doesn't always carry a
 * linked patient_id, the practice-wide recency check is the safe default.
 */
export async function hasRecentCrisisAtPractice(
  practiceId: string,
  settings: CancellationFillSettings
): Promise<boolean> {
  const sinceMs = Date.now() - settings.crisis_lookback_days * 86_400_000
  const since = new Date(sinceMs).toISOString()

  const { count, error } = await supabaseAdmin
    .from('crisis_alerts')
    .select('id', { count: 'exact', head: true })
    .eq('practice_id', practiceId)
    .gte('triggered_at', since)

  if (error) {
    // On error, FAIL CLOSED — treat as crisis present.
    console.warn('[exclusions] crisis check failed; failing closed', error)
    return true
  }
  return (count ?? 0) > 0
}

// ---------------------------------------------------------------------------
// PER-CANDIDATE FILTERS
// ---------------------------------------------------------------------------

/**
 * §2 — SMS opt-out is absolute.
 */
export async function isCandidateSmsOptedOut(
  practiceId: string,
  phone: string | null | undefined
): Promise<boolean> {
  if (!phone) return false // no phone → nothing to opt out FROM; handled elsewhere
  try {
    return await isOptedOut(practiceId, phone)
  } catch (e) {
    console.warn('[exclusions] SMS opt-out check errored; failing closed', e)
    return true
  }
}

/**
 * §2 — Email opt-out is absolute.
 */
export async function isCandidateEmailOptedOut(
  practiceId: string,
  email: string | null | undefined
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
 * §1 — Per-patient crisis check.
 *
 * Some crisis_alerts rows are linked to a specific caller phone. If THIS
 * candidate's phone shows up in any recent alert, exclude them individually
 * (in addition to the practice-wide check above).
 */
export async function isPatientInCrisisLookback(
  practiceId: string,
  patientPhone: string | null | undefined,
  settings: CancellationFillSettings
): Promise<boolean> {
  if (!patientPhone) return false
  const since = new Date(
    Date.now() - settings.crisis_lookback_days * 86_400_000
  ).toISOString()

  const { count, error } = await supabaseAdmin
    .from('crisis_alerts')
    .select('id', { count: 'exact', head: true })
    .eq('practice_id', practiceId)
    .eq('patient_phone', patientPhone)
    .gte('triggered_at', since)

  if (error) {
    console.warn('[exclusions] patient crisis check failed; failing closed', error)
    return true
  }
  return (count ?? 0) > 0
}

/**
 * §5 — New patients require therapist review.
 *
 * A "new patient" is one with no intake_completed OR zero prior appointments.
 * They are NOT excluded from the pool — they are held for therapist review
 * by routing their would-be offer to a notification rather than an SMS.
 *
 * This function returns true when the candidate needs human review.
 */
export function newPatientRequiresReview(patient: CandidatePatient): boolean {
  if (!patient.intake_completed) return true
  if (!patient.total_appointments || patient.total_appointments < 1) return true
  return false
}

/**
 * Soft limit A — No-show pattern (default: 2+ no-shows in last 30 days).
 *
 * We hold for review rather than permanently exclude. The 30-day lookback
 * intentionally allows patterns to reset when a patient stabilizes.
 */
export function hasRecentNoShowPattern(
  patient: CandidatePatient,
  settings: CancellationFillSettings
): boolean {
  const threshold = settings.no_show_threshold
  // We only have a total no_show_count on patients — we don't yet track
  // per-window no-show counts. For observational mode this is an OK proxy;
  // Phase 3 should add a windowed query against appointments.status='no_show'.
  return (patient.no_show_count ?? 0) >= threshold
}

/**
 * Intake-incomplete gate. Patients without completed intake paperwork never
 * get auto-offered because first-session fit needs human judgment.
 */
export function hasIncompleteIntake(patient: CandidatePatient): boolean {
  return !patient.intake_completed
}

/**
 * §4 — Therapeutic continuity.
 *
 * A cancelled slot stays with the same therapist. We never cross-offer.
 *
 * NOTE — current schema limitation: neither `appointments` nor `patients`
 * carries an `assigned_therapist_id`. Until that schema lands, this function
 * ALWAYS returns false (no cross-therapist offer is possible) when the
 * practice has a single therapist, and returns true (block) for any
 * multi-therapist practice where we cannot prove same-therapist continuity.
 *
 * This is intentionally the stricter interpretation: if we can't prove it's
 * safe, we hold for review rather than risk crossing a boundary.
 */
export async function wouldBreakTherapistContinuity(
  practiceId: string,
  _candidatePatientId: string
): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from('therapists')
    .select('id', { count: 'exact', head: true })
    .eq('practice_id', practiceId)
    .eq('is_active', true)

  const therapistCount = count ?? 0
  if (therapistCount <= 1) return false // solo practice → trivially continuous
  // Multi-therapist practice: we don't yet have assignment data. Block.
  return true
}

/**
 * Soft limit C — preferred-times mismatch.
 *
 * Placeholder. Real implementation would parse the patient's preferred_times
 * freeform text vs. the slot day/hour. For observational mode, we return
 * false (never blocks on this signal) so we can collect data without acting.
 */
export function preferredTimesMismatch(
  _patient: CandidatePatient | CandidateWaitlistEntry,
  _slotStart: Date
): boolean {
  return false
}

// ---------------------------------------------------------------------------
// Convenience aggregator — run all per-candidate filters, return first reason
// ---------------------------------------------------------------------------

export interface CandidateContext {
  practiceId: string
  settings: CancellationFillSettings
  slotStart: Date
}

/**
 * Evaluate a patient candidate against every filter. Returns null if they
 * pass; otherwise the first block reason encountered.
 */
export async function evaluatePatientCandidate(
  ctx: CandidateContext,
  patient: CandidatePatient
): Promise<CandidateBlockReason | null> {
  // Opt-outs are absolute (§2) — check first so we never make a network
  // call or do any further work on an opted-out candidate.
  if (patient.phone && (await isCandidateSmsOptedOut(ctx.practiceId, patient.phone))) {
    return 'sms_opted_out'
  }
  if (patient.email && (await isCandidateEmailOptedOut(ctx.practiceId, patient.email))) {
    return 'email_opted_out'
  }
  // §1
  if (
    patient.phone &&
    (await isPatientInCrisisLookback(ctx.practiceId, patient.phone, ctx.settings))
  ) {
    return 'patient_in_crisis'
  }
  // §4
  if (await wouldBreakTherapistContinuity(ctx.practiceId, patient.id)) {
    return 'different_therapist'
  }
  // Intake / no-show / balance
  if (hasIncompleteIntake(patient)) return 'intake_incomplete'
  if (hasRecentNoShowPattern(patient, ctx.settings)) return 'no_show_pattern'
  // §5 — new patient review: we flag but do NOT exclude from the pool;
  // callers decide whether to route to therapist-review channel. Returning
  // this reason causes the candidate to be skipped for auto-send. Phase 3
  // will add a separate "review queue" channel where §5 candidates land.
  if (newPatientRequiresReview(patient)) return 'new_patient_requires_review'
  if (preferredTimesMismatch(patient, ctx.slotStart)) return 'preferred_times_mismatch'
  return null
}

/**
 * Evaluate a waitlist entry against every applicable filter.
 * Waitlist entries don't carry full patient context so some filters are skipped.
 */
export async function evaluateWaitlistCandidate(
  ctx: CandidateContext,
  entry: CandidateWaitlistEntry
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
  if (
    entry.patient_phone &&
    (await isPatientInCrisisLookback(ctx.practiceId, entry.patient_phone, ctx.settings))
  ) {
    return 'patient_in_crisis'
  }
  if (preferredTimesMismatch(entry, ctx.slotStart)) return 'preferred_times_mismatch'
  return null
}

// ---------------------------------------------------------------------------
// PRACTICE-LEVEL AGGREGATOR
// ---------------------------------------------------------------------------

export async function checkHardBlocks(
  practiceId: string,
  settings: CancellationFillSettings,
  slotStart: Date
): Promise<HardBlockReason | null> {
  if (!settings.dispatcher_enabled) return 'dispatcher_disabled'
  if (slotStart.getTime() <= Date.now()) return 'slot_in_past'
  if (await hasRecentCrisisAtPractice(practiceId, settings)) return 'crisis_in_lookback'
  return null
}
