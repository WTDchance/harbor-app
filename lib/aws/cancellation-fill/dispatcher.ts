// Cancellation Fill — Dispatcher (Phase 2, observational-only) — AWS port.
//
// Reads a cancelled appointment, computes the bucket, enforces ethical hard
// blocks, assembles a candidate pool, filters per-candidate, and writes
// audit rows into cancellation_fill_offers. DOES NOT SEND SMS OR EMAIL.
// Phase 3 wires real outreach as part of the SignalWire/Retell carrier
// swap batch.
//
// AWS canonical schema notes:
//   appointments.scheduled_for replaces the legacy scheduled_at column.
//   The CancelledAppointmentInput interface keeps `scheduled_at` as the
//   field name so callers (route, library tests) don't change — the
//   mapping happens at the SQL boundary in dispatchByAppointmentId().
//
// AWS canonical patients schema doesn't carry intake_completed,
// no_show_count, total_appointments, last_appointment_at, or
// cancellation_count. Until those columns get migrated over, the AWS
// port SELECTs whatever's there and treats absent fields as null. The
// per-candidate filters in exclusions.ts are schema-gap-aware.

import { pool } from '@/lib/aws/db'
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

const OFFER_WINDOW_MINUTES: Record<FillBucket | 'shift_earlier', number> = {
  '24plus': 12 * 60,
  '8_to_24': 2 * 60,
  '2_to_8': 15,
  sub_1: 10,
  shift_earlier: 15,
}

const MAX_PARALLEL_PER_BUCKET: Record<FillBucket, number> = {
  '24plus': 1,
  '8_to_24': 3,
  '2_to_8': 3,
  sub_1: 2, // overridden by settings.flash_fill_max_recipients
}

// ---------------------------------------------------------------------------
// Candidate pool builders
// ---------------------------------------------------------------------------

async function getExistingPatientCandidates(
  practiceId: string,
): Promise<CandidatePatient[]> {
  // SELECT only AWS canonical columns. Try to also read the legacy fields
  // (intake_completed, no_show_count, total_appointments, last_appointment_at,
  // cancellation_count) via a defensive try-cascade; if they don't exist on
  // RDS we degrade to nulls, and the per-candidate filters handle null.
  try {
    const { rows } = await pool.query(
      `SELECT id, practice_id, first_name, last_name, phone, email,
              intake_completed, no_show_count, cancellation_count,
              last_appointment_at, total_appointments
         FROM patients
        WHERE practice_id = $1 AND phone IS NOT NULL
        ORDER BY total_appointments DESC NULLS LAST,
                 last_appointment_at DESC NULLS LAST
        LIMIT 50`,
      [practiceId],
    )
    return rows as CandidatePatient[]
  } catch {
    // Schema gap — those columns aren't on AWS canonical patients yet.
    // Fall back to canonical-only and fill nulls.
    const { rows } = await pool.query(
      `SELECT id, practice_id, first_name, last_name, phone, email
         FROM patients
        WHERE practice_id = $1 AND phone IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 50`,
      [practiceId],
    ).catch(() => ({ rows: [] as any[] }))
    return rows.map((r: any) => ({
      id: r.id,
      practice_id: r.practice_id,
      first_name: r.first_name ?? null,
      last_name: r.last_name ?? null,
      phone: r.phone ?? null,
      email: r.email ?? null,
      intake_completed: null,
      no_show_count: null,
      cancellation_count: null,
      last_appointment_at: null,
      total_appointments: null,
    }))
  }
}

async function getWaitlistCandidates(
  practiceId: string,
  bucket: FillBucket,
  waitlistSort: 'fifo' | 'composite' | 'priority',
): Promise<CandidateWaitlistEntry[]> {
  const conds: string[] = ['practice_id = $1', `status = 'waiting'`]
  const args: unknown[] = [practiceId]
  if (bucket === '2_to_8') conds.push('opt_in_last_minute = true')
  if (bucket === 'sub_1') conds.push('opt_in_flash_fill = true')

  let orderBy: string
  switch (waitlistSort) {
    case 'composite':
      orderBy = 'composite_score DESC NULLS LAST'
      break
    case 'priority':
      orderBy = 'priority DESC, created_at ASC'
      break
    case 'fifo':
    default:
      orderBy = 'created_at ASC'
      break
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, practice_id, patient_name, patient_phone, patient_email,
              priority, status, flexible_day_time, opt_in_last_minute,
              opt_in_flash_fill, composite_score, created_at
         FROM waitlist
        WHERE ${conds.join(' AND ')}
        ORDER BY ${orderBy}
        LIMIT 25`,
      args,
    )
    return rows as CandidateWaitlistEntry[]
  } catch (err) {
    console.warn('[dispatcher] waitlist query failed', (err as Error).message)
    return []
  }
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

export async function dispatch(
  appt: CancelledAppointmentInput,
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

  if (bucket === 'sub_1') {
    return handleSubOneHour(appt, slotStart, settings, baseDecision)
  }

  const ctx: CandidateContext = {
    practiceId: appt.practice_id,
    settings,
    slotStart,
  }

  const waitlistPool = await getWaitlistCandidates(
    appt.practice_id,
    bucket,
    settings.waitlist_sort,
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

  // bucket is narrowed to non-'sub_1' here (sub_1 returned early above)
  const parallelCap = MAX_PARALLEL_PER_BUCKET[bucket]
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

async function handleSubOneHour(
  appt: CancelledAppointmentInput,
  slotStart: Date,
  settings: CancellationFillSettings,
  decision: DispatchDecision,
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

  // Phase 2: shift-earlier / flash-fill / accept-loss are all log-only.
  // Real execution lands alongside the SignalWire/Retell carrier swap.
  return decision
}

// ---------------------------------------------------------------------------
// Public helper: dispatch by appointment ID (what the HTTP route calls)
// ---------------------------------------------------------------------------

export async function dispatchByAppointmentId(
  appointmentId: string,
): Promise<DispatchDecision | { error: string }> {
  // AWS canonical column is scheduled_for, not scheduled_at.
  const { rows } = await pool.query(
    `SELECT id, practice_id, patient_id, scheduled_for, duration_minutes,
            appointment_type, status
       FROM appointments
      WHERE id = $1
      LIMIT 1`,
    [appointmentId],
  ).catch(err => ({ rows: [] as any[], _err: err }))
  const data = rows[0]
  if (!data) return { error: 'appointment not found' }
  if (data.status !== 'cancelled' && data.status !== 'cancelled_late') {
    return { error: `appointment status is '${data.status}', not cancelled` }
  }
  if (!data.scheduled_for) return { error: 'appointment has no scheduled_for' }

  return dispatch({
    id: data.id,
    practice_id: data.practice_id,
    patient_id: data.patient_id,
    scheduled_at: new Date(data.scheduled_for).toISOString(),
    duration_minutes: data.duration_minutes,
    appointment_type: data.appointment_type,
  })
}
