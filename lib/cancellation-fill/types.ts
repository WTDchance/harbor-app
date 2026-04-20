/**
 * Cancellation Fill — Shared types
 *
 * All bucket names, decision shapes, and policy settings live here.
 * Keep this file pure types — no runtime imports — so it can be consumed
 * by both the dispatcher server code and any future UI.
 *
 * Hard limits referenced in this module map to sections in
 * `docs/cancellation-fill-ethics.md`.
 */

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

/** Time-based classification of a newly-opened slot. */
export type FillBucket = '24plus' | '8_to_24' | '2_to_8' | 'sub_1'

/** What to do when a slot lands in the sub-1-hour bucket. */
export type SubOneHourAction = 'shift_earlier' | 'accept_loss' | 'flash_fill'

/** How to order waitlist candidates inside a bucket. */
export type WaitlistSort = 'fifo' | 'composite' | 'priority'

// ---------------------------------------------------------------------------
// Practice-level dispatcher settings (stored in practices.cancellation_fill_settings JSONB)
// ---------------------------------------------------------------------------

export interface CancellationFillSettings {
  /**
   * Master kill switch. When false, dispatcher logs observational
   * decisions but never sends outreach, regardless of bucket toggles.
   * Default: false (fail-closed).
   */
  dispatcher_enabled: boolean
  auto_fill_24plus: boolean
  auto_fill_8_to_24: boolean
  auto_fill_2_to_8: boolean
  sub_1_hour_action: SubOneHourAction
  late_cancel_fee_cents: number
  waitlist_sort: WaitlistSort
  flash_fill_max_recipients: number
  insurance_eligibility_gate: boolean
  crisis_lookback_days: number
  no_show_lookback_days: number
  no_show_threshold: number
  outstanding_balance_threshold_cents: number
}

// ---------------------------------------------------------------------------
// Dispatch inputs / outputs
// ---------------------------------------------------------------------------

/** Minimal shape of an appointment needed to dispatch a fill decision. */
export interface CancelledAppointmentInput {
  id: string
  practice_id: string
  patient_id: string | null
  /** ISO timestamp of when the slot was scheduled. Source of truth for bucket math. */
  scheduled_at: string
  duration_minutes: number | null
  appointment_type: string | null
}

/** Reasons the dispatcher refused to auto-fill (all mapped to ethics doc). */
export type HardBlockReason =
  | 'dispatcher_disabled' // master switch off
  | 'bucket_disabled' // practice turned off this bucket
  | 'crisis_in_lookback' // §1 — practice-level crisis recency
  | 'insurance_eligibility_gate_not_yet_implemented'
  | 'missing_settings'
  | 'slot_in_past'

/** Why a specific candidate was skipped. Soft — doesn't stop dispatch, just that one person. */
export type CandidateBlockReason =
  | 'sms_opted_out' // §2
  | 'email_opted_out' // §2
  | 'patient_in_crisis' // §1
  | 'different_therapist' // §4 therapeutic continuity
  | 'new_patient_requires_review' // §5
  | 'no_show_pattern' // A soft limit (held for review)
  | 'intake_incomplete' // practice policy
  | 'outstanding_balance' // practice policy
  | 'preferred_times_mismatch' // C soft limit

/** The outcome of dispatch(). */
export interface DispatchDecision {
  /** Bucket we computed from the slot time. */
  bucket: FillBucket
  /** True if we WOULD have attempted to fill (all hard gates passed). */
  wouldAttempt: boolean
  /** If wouldAttempt is false, why not. */
  hardBlock: HardBlockReason | null
  /** Always populated: what action the sub-1 policy mapped to. Null for other buckets. */
  subOneAction: SubOneHourAction | null
  /** Count of candidates we identified before per-candidate filtering. */
  candidatePoolSize: number
  /** Per-candidate filter summary — for audit. */
  candidateFilter: {
    eligible: number
    blockedByReason: Partial<Record<CandidateBlockReason, number>>
  }
  /** Whether this dispatch was observation-only (Phase 2 default). */
  observationalOnly: boolean
  /** IDs of cancellation_fill_offers rows written by this dispatch. */
  offerIds: string[]
}

// ---------------------------------------------------------------------------
// Candidate shapes
// ---------------------------------------------------------------------------

export interface CandidatePatient {
  id: string
  practice_id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
  intake_completed: boolean | null
  no_show_count: number | null
  cancellation_count: number | null
  last_appointment_at: string | null
  total_appointments: number | null
}

export interface CandidateWaitlistEntry {
  id: string
  practice_id: string
  patient_name: string | null
  patient_phone: string | null
  patient_email: string | null
  priority: string | null
  status: string | null
  flexible_day_time: boolean | null
  opt_in_last_minute: boolean | null
  opt_in_flash_fill: boolean | null
  composite_score: number | null
  created_at: string | null
}
