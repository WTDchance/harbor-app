/**
 * Cancellation Fill — Dispatcher (Phase 2, observational-only)
 *
 * Reads a cancelled appointment, computes the bucket, enforces ethical hard
 * blocks, assembles a candidate pool, filters per-candidate, and writes
 * audit rows. DOES NOT SEND SMS OR EMAIL. Phase 3 wires real outreach once
 * we've seen real-world decisions logged cleanly.
 *
 * Every decision in this file corresponds to a section of
 * docs/cancellation-fill-ethics.md. See exclusions.ts for the per-gate map.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { computeBucket, formatLeadTime, leadTimeHours } from './bucket'
import { loadSettings, bucketEnabled } from './policy'
import {
  checkHardBlocks,
  evaluatePatientCandidate,
  evaluateWaitlistCandidate,
  type CandidateContext,
} from './exclusions'
import { logObservedOffer, logDispatchSummary } from './audit'
import type {
  CancelledAppointmentInput,
  CancellationFillSettings,
  DispatchDecision,
  CandidatePatient,
  CandidateWaitlistEntry,
  CandidateBlockReason,
  FillBucket,
  SubOneHourAction,
} from './types'

// ---------------------------------------------------------------------------
// Offer-window defaults per bucket (matches docs/cancellation-policy.md)
// ---------------------------------------------------------------------------
const OFFER_WINDOW_MINUTES: Record<FillBucket | 'shift_earlier', number> = {
  '24plus': 12 * 60, // 12h to respond
  '8_to_24': 2 * 60, // 2h
  '2_to_8': 15, // 15min per wave
  sub_1: 10, // 10min
  shift_earlier: 15,
}

// Candidate pool size per bucket (how many people we might text in parallel)
const MAX_PARALLEL_PER_BUCKET: Record<FillBucket, number> = {
  '24plus': 1, // sequential — email + SMS follow-up to ONE at a time
  '8_to_24': 3,
  '2_to_8': 3,
  sub_1: 2, // flash_fill default; overridden by settings.flash_fill_max_recipients
}

// ---------------------------------------------------------------------------
// Candidate pool builders
// ---------------------------------------------------------------------------

/**
 * Existing patients pool. Current status='active', ordered by most-engaged
 * (total_appointments DESC, last_appointment_at DESC). Size-capped at 50 —
 * the per-candidate filter prunes the long tail.
 */
async function getExistingPatientCandidates(
  practiceId: string
): Promise<CandidatePatient[]> {
  const { data, error } = await supabaseAdmin
    .from('patients')
    .select(
      'id, practice_id, first_name, last_name, phone, email, intake_completed, no_show_count, cancellation_count, last_appointment_at, total_appointments'
    )
    .eq('practice_id', practiceId)
    .not('phone', 'is', null)
    .order('total_appointments', { ascending: false, nullsFirst: false })
    .order('last_appointment_at', { ascending: false, nullsFirst: false })
    .limit(50)
  if (error) {
    console.warn('[dispatcher] existing-patient pool query failed', error)
    return []
  }
  return (data as CandidatePatient[]) ?? []
}

/**
 * Waitlist pool. Status='waiting' only. Sort is policy-driven.
 *
 * For 2-8 and sub-1 buckets, we further require opt_in_last_minute=true or
 * opt_in_flash_fill=true, respectively. This is §8 adjacent — a patient who
 * hasn't opted into last-minute texts must not be surprised by one.
 */
async function getWaitlistCandidates(
  practiceId: string,
  bucket: FillBucket,
  waitlistSort: 'fifo' | 'composite' | 'priority'
): Promise<CandidateWaitlistEntry[]> {
  let q = supabaseAdmin
    .from('waitlist')
    .select(
      'id, practice_id, patient_name, patient_phone, patient_email, priority, status, flexible_day_time, opt_in_last_minute, opt_in_flash_fill, composite_score, created_at'
    )
    .eq('practice_id', practiceId)
    .eq('status', 'waiting')

  if (bucket === '2_to_8') q = q.eq('opt_in_last_minute', true)
  if (bucket === 'sub_1') q = q.eq('opt_in_flash_fill', true)

  switch (waitlistSort) {
    case 'composite':
      q = q.order('composite_score', { ascending: false, nullsFirst: false })
      break
    case 'priority':
      q = q.order('priority', { ascending: false }).order('created_at', { ascending: true })
      break
    case 'fifo':
    default:
      q = q.order('created_at', { ascending: true })
      break
  }

  const { data, error } = await q.limit(25)
  if (error) {
    console.warn('[dispatcher] waitlist query failed', error)
    return []
  }
  return (data as CandidateWaitlistEntry[]) ?? []
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

export async function dispatch(
  appt: CancelledAppointmentInput
): Promise<DispatchDecision> {
  const slotStart = new Date(appt.scheduled_at)
  const now = new Date()
  const bucket = computeBucket(slotStart, now)
  const settings = await loadSettings(appt.practice_id)

  const baseDecision: DispatchDecision = {
    bucket,
    wouldAttempt: false,
    hardBlock: null,
    subOneAction: bucket === 'sub_1' ? settings.sub_1_hour_action : null,
    candidatePoolSize: 0,
    candidateFilter: { eligible: 0, blockedByReason: {} },
    observationalOnly: true,
    offerIds: [],
  }

  // --- HARD BLOCKS --------------------------------------------------------
  const hardBlock = await checkHardBlocks(appt.practice_id, settings, slotStart)
  if (hardBlock) {
    const summaryId = await logDispatchSummary({
      practiceId: appt.practice_id,
      appointmentId: appt.id,
      slotTime: appt.scheduled_at,
      bucket,
      summary:
        `Hard block: ${hardBlock}. leadTime=${formatLeadTime(leadTimeHours(slotStart, now))} ` +
        `dispatcher_enabled=${settings.dispatcher_enabled}`,
    })
    if (summaryId) baseDecision.offerIds.push(summaryId)
    return { ...baseDecision, hardBlock }
  }

  // --- BUCKET-LEVEL ENABLED? ---------------------------------------------
  if (!bucketEnabled(bucket, settings)) {
    const summaryId = await logDispatchSummary({
      practiceId: appt.practice_id,
      appointmentId: appt.id,
      slotTime: appt.scheduled_at,
      bucket,
      summary: `Bucket '${bucket}' auto-fill disabled by practice settings.`,
    })
    if (summaryId) baseDecision.offerIds.push(summaryId)
    return { ...baseDecision, hardBlock: 'bucket_disabled' }
  }

  // --- SUB-1 SPECIAL ROUTING ---------------------------------------------
  // sub_1 doesn't fan out to waitlist pool directly. It either:
  //   * shift_earlier → offer the SAME therapist's next-scheduled patient an earlier slot
  //   * accept_loss   → log and move on
  //   * flash_fill    → up to N opted-in waitlist entries with 10-min window
  // Phase 2 observational just logs the intended path; real execution lands in Phase 3/4.
  if (bucket === 'sub_1') {
    return handleSubOneHour(appt, slotStart, settings, baseDecision)
  }

  // --- STANDARD BUCKETS: pool → filter → log ------------------------------
  const ctx: CandidateContext = {
    practiceId: appt.practice_id,
    settings,
    slotStart,
  }

  const waitlistPool = await getWaitlistCandidates(
    appt.practice_id,
    bucket,
    settings.waitlist_sort
  )
  const patientPool =
    bucket === '24plus' || bucket === '8_to_24'
      ? await getExistingPatientCandidates(appt.practice_id)
      : [] // 2-8 is waitlist-only per policy

  baseDecision.candidatePoolSize = waitlistPool.length + patientPool.length

  const eligible: Array<
    | { kind: 'waitlist'; entry: CandidateWaitlistEntry }
    | { kind: 'patient'; patient: CandidatePatient }
  > = []
  const blockedByReason: Partial<Record<CandidateBlockReason, number>> = {}

  for (const entry of waitlistPool) {
    const reason = await evaluateWaitlistCandidate(ctx, entry)
    if (reason) {
      blockedByReason[reason] = (blockedByReason[reason] ?? 0) + 1
      continue
    }
    eligible.push({ kind: 'waitlist', entry })
  }
  for (const patient of patientPool) {
    const reason = await evaluatePatientCandidate(ctx, patient)
    if (reason) {
      blockedByReason[reason] = (blockedByReason[reason] ?? 0) + 1
      continue
    }
    eligible.push({ kind: 'patient', patient })
  }

  baseDecision.candidateFilter = { eligible: eligible.length, blockedByReason }

  // How many to offer in parallel for this bucket?
  const parallelCap =
    bucket === 'sub_1'
      ? settings.flash_fill_max_recipients
      : MAX_PARALLEL_PER_BUCKET[bucket]
  const pick = eligible.slice(0, parallelCap)

  if (pick.length === 0) {
    const summaryId = await logDispatchSummary({
      practiceId: appt.practice_id,
      appointmentId: appt.id,
      slotTime: appt.scheduled_at,
      bucket,
      summary:
        `No eligible candidates. pool=${baseDecision.candidatePoolSize} ` +
        `blocked=${JSON.stringify(blockedByReason)}`,
    })
    if (summaryId) baseDecision.offerIds.push(summaryId)
    return baseDecision
  }

  // --- WRITE OBSERVED OFFERS (no sending) --------------------------------
  for (const c of pick) {
    const id = await logObservedOffer({
      practice_id: appt.practice_id,
      original_appointment_id: appt.id,
      slot_time: appt.scheduled_at,
      bucket,
      offered_to_patient_id: c.kind === 'patient' ? c.patient.id : null,
      offered_to_waitlist_id: c.kind === 'waitlist' ? c.entry.id : null,
      expires_in_minutes: OFFER_WINDOW_MINUTES[bucket],
      notes:
        c.kind === 'patient'
          ? `observed: existing patient ${c.patient.id} (${c.patient.total_appointments ?? 0} prior appts)`
          : `observed: waitlist ${c.entry.id} (${c.entry.priority ?? 'standard'} priority)`,
      channel: 'none',
      status: 'observed',
    })
    if (id) baseDecision.offerIds.push(id)
  }

  return { ...baseDecision, wouldAttempt: true }
}

// ---------------------------------------------------------------------------
// Sub-1-hour action router (observational)
// ---------------------------------------------------------------------------

async function handleSubOneHour(
  appt: CancelledAppointmentInput,
  slotStart: Date,
  settings: CancellationFillSettings,
  decision: DispatchDecision
): Promise<DispatchDecision> {
  const action: SubOneHourAction = settings.sub_1_hour_action
  decision.subOneAction = action

  const note =
    `sub_1 action='${action}' slotStart=${slotStart.toISOString()} ` +
    `leadTime=${formatLeadTime(leadTimeHours(slotStart, new Date()))}`

  const id = await logDispatchSummary({
    practiceId: appt.practice_id,
    appointmentId: appt.id,
    slotTime: appt.scheduled_at,
    bucket: action === 'shift_earlier' ? 'shift_earlier' : 'sub_1',
    summary: note,
  })
  if (id) decision.offerIds.push(id)

  // Phase 2: we don't actually execute shift-earlier, flash-fill, or accept-loss.
  // Phase 3/4 wire those up. For now, wouldAttempt stays false.
  return decision
}

// ---------------------------------------------------------------------------
// Public helper: dispatch by appointment ID (what the HTTP route calls)
// ---------------------------------------------------------------------------

export async function dispatchByAppointmentId(
  appointmentId: string
): Promise<DispatchDecision | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('appointments')
    .select('id, practice_id, patient_id, scheduled_at, duration_minutes, appointment_type, status')
    .eq('id', appointmentId)
    .single()

  if (error || !data) return { error: error?.message ?? 'appointment not found' }
  if (data.status !== 'cancelled' && data.status !== 'cancelled_late') {
    return { error: `appointment status is '${data.status}', not cancelled` }
  }
  if (!data.scheduled_at) return { error: 'appointment has no scheduled_at' }
  // Past-time cancels still dispatch — dispatch() emits a slot_in_past hard
  // block for a consistent audit trail.

  return dispatch({
    id: data.id,
    practice_id: data.practice_id,
    patient_id: data.patient_id,
    scheduled_at: data.scheduled_at,
    duration_minutes: data.duration_minutes,
    appointment_type: data.appointment_type,
  })
}
