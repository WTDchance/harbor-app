// Cancellation Fill — Audit logger (AWS port).
//
// Every dispatch attempt writes rows into cancellation_fill_offers. In
// Phase 2 (observational only) we record status='observed' — no outreach
// is sent. Phase 3 replaces 'observed' with 'pending' when SMS/email
// actually go out (the SignalWire/Retell batch wires that), and the
// waitlist confirm flow later updates to 'claimed' or 'expired'.
//
// Implements §10 (data retention: minimum necessary) by persisting only
// patient IDs + timestamps, never PHI blobs.

import { pool } from '@/lib/aws/db'
import type { FillBucket } from './types'

export interface ObservedOfferRecord {
  practice_id: string
  original_appointment_id: string
  slot_time: string // ISO
  bucket: FillBucket | 'shift_earlier'
  offered_to_patient_id: string | null
  offered_to_waitlist_id: string | null
  /** Minutes from now until the offer would expire. */
  expires_in_minutes: number
  /** Short audit note describing why this candidate was selected or blocked. */
  notes: string
  /** 'none' in observational mode since no channel send happened. */
  channel?: 'sms' | 'email' | 'both' | 'none'
  /** 'observed' in Phase 2; Phase 3+ uses 'pending' then mutates. */
  status?: 'pending' | 'observed'
}

/** Insert one observational-only offer row. Returns the row id, or null
 *  on DB error (audit must never block dispatch). */
export async function logObservedOffer(rec: ObservedOfferRecord): Promise<string | null> {
  const offeredAt = new Date()
  const expiresAt = new Date(offeredAt.getTime() + rec.expires_in_minutes * 60_000)

  try {
    const { rows } = await pool.query(
      `INSERT INTO cancellation_fill_offers (
         practice_id, original_appointment_id, slot_time, bucket, channel,
         offered_at, offer_expires_at, status,
         offered_to_patient_id, offered_to_waitlist_id, notes
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8,
         $9, $10, $11
       ) RETURNING id`,
      [
        rec.practice_id,
        rec.original_appointment_id,
        rec.slot_time,
        rec.bucket,
        rec.channel ?? 'none',
        offeredAt.toISOString(),
        expiresAt.toISOString(),
        rec.status ?? 'observed',
        rec.offered_to_patient_id,
        rec.offered_to_waitlist_id,
        rec.notes.slice(0, 2000),
      ],
    )
    return rows[0]?.id ?? null
  } catch (err) {
    console.error('[audit] failed to write cancellation_fill_offers row:', (err as Error).message)
    return null
  }
}

/** Sentinel-row variant for "no candidate offered" outcomes. */
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
