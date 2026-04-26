// SMS opt-out READ helper for the AWS path.
//
// Mirrors lib/email-optout.isEmailOptedOut. The full STOP-keyword
// classification + opt-out CRUD lives in lib/sms-optout (Supabase) for
// now and gets ported as part of the SignalWire/Retell carrier swap
// batch. Here we only need the read so the cancellation-fill dispatcher
// can enforce §2 of the ethics policy.

import { pool } from './db'

function normalize(phone: string): string {
  return (phone || '').trim()
}

/**
 * True if the given phone has opted out of SMS from this practice.
 * Fails open (returns false on DB error or missing table) — same posture
 * as the email opt-out check.
 */
export async function isSmsOptedOut(
  practiceId: string,
  phone: string,
): Promise<boolean> {
  const p = normalize(phone)
  if (!p) return false
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM sms_opt_outs
        WHERE practice_id = $1 AND phone = $2
        LIMIT 1`,
      [practiceId, p],
    )
    return rows.length > 0
  } catch (err) {
    console.error('[sms-optout] isSmsOptedOut check failed:', (err as Error).message)
    return false
  }
}
