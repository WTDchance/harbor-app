/**
 * Cancellation Fill — Audit logger
 *
 * Every dispatch attempt writes rows into cancellation_fill_offers.
 * In Phase 2 (observational only) we record status='observed' — no outreach
 * is sent. Phase 3 replaces 'observed' with 'pending' when SMS/email actually
 * go out, and the waitlist confirm flow later updates to 'claimed' or 'expired'.
 *
 * Implements §10 (data retention: minimum necessary) by persisting only
 * patient IDs + timestamps, never PHI blobs.
 */

import { supabaseAdmin } from '@/lib/supabase'
import type { FillBucket } from './types'

export interface ObservedOfferRecord {
  practice_id: string
  original_appointment_id: string
  slot_time: string // ISO
  bucket: FillBucket | 'shift_earlier'
  offered_to_patient_id: string | null
  offered_to_waitlist_id: string | null
  /** Minutes from now until the offer would expire. Used to compute offer_expires_at. */
  expires_in_minutes: number
  /** Short audit note describing why this candidate was selected or blocked. */
  notes: string
  /** 'none' in observational mode since no channel send happened. */
  channel?: 'sms' | 'email' | 'both' | 'none'
  /** 'observed' in Phase 2; Phase 3+ uses 'pending' then mutates. */
  status?: 'pending' | 'observed'
}

/** Write a single observational-only offer row. Returns the inserted id. */
export async function logObservedOffer(rec: ObservedOfferRecord): Promise<string | null> {
  const offeredAt = new Date()
  const expiresAt = new Date(offeredAt.getTime() + rec.expires_in_minutes * 60_000)

  const { data, error } = await supabaseAdmin
    .from('cancellation_fill_offers')
    .insert({
      practice_id: rec.practice_id,
      original_appointment_id: rec.original_appointment_id,
      slot_time: rec.slot_time,
      bucket: rec.bucket,
      channel: rec.channel ?? 'none',
      offered_at: offeredAt.toISOString(),
      offer_expires_at: expiresAt.toISOString(),
      status: rec.status ?? 'observed',
      offered_to_patient_id: rec.offered_to_patient_id,
      offered_to_waitlist_id: rec.offered_to_waitlist_id,
      notes: rec.notes.slice(0, 2000),
    })
    .select('id')
    .single()

  if (error) {
    console.error('[audit] failed to write cancellation_fill_offers row', error)
    return null
  }
  return data?.id ?? null
}

/**
 * Write a single summary row describing the dispatch result when NO candidates
 * were offered at all (hard-block, empty pool, or all candidates filtered).
 * Uses a sentinel: no patient_id, no waitlist_id, notes carries the reason.
 */
export async function logDispatchSummary(args: {
  practiceId: string
  appointmentId: string
  slotTime: string
  bucket: FillBucket | 'shift_earlier'
  summary: string
}): Promise<string | null> {
  return logObservedOffer({
    practice_id: args.practiceId,
    original_appointment_id: args.appointmentId,
    slot_time: args.slotTime,
    bucket: args.bucket,
    offered_to_patient_id: null,
    offered_to_waitlist_id: null,
    expires_in_minutes: 0,
    notes: `[dispatch-summary] ${args.summary}`,
    channel: 'none',
    status: 'observed',
  })
}
