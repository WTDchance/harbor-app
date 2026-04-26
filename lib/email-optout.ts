// Email opt-out / unsubscribe handling — AWS port (RDS via pg pool).
//
// Mirrors lib/sms-optout.ts. Called by lib/email.sendPatientEmail before
// any patient-facing send, and from the dashboard Communication
// preferences toggle.

import { pool } from './aws/db'

function normalize(email: string): string {
  return (email || '').trim().toLowerCase()
}

export type EmailOptOutSource = 'dashboard' | 'inbound' | 'api' | 'bounce'

/** Idempotent upsert. Records a practice/email opt-out pair. */
export async function recordEmailOptOut(
  practiceId: string,
  email: string,
  source: EmailOptOutSource = 'dashboard',
  keyword?: string,
): Promise<void> {
  const e = normalize(email)
  if (!e) return
  try {
    await pool.query(
      `INSERT INTO email_opt_outs (practice_id, email, source, keyword)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (practice_id, email) DO UPDATE
         SET source = EXCLUDED.source,
             keyword = EXCLUDED.keyword,
             updated_at = NOW()`,
      [practiceId, e, source, keyword?.toUpperCase() ?? null],
    )
  } catch (err) {
    console.error('[email-optout] failed to record opt-out:', (err as Error).message)
  }
}

/** Remove an opt-out so the patient can receive email again. */
export async function clearEmailOptOut(
  practiceId: string,
  email: string,
): Promise<void> {
  const e = normalize(email)
  if (!e) return
  try {
    await pool.query(
      `DELETE FROM email_opt_outs WHERE practice_id = $1 AND email = $2`,
      [practiceId, e],
    )
  } catch (err) {
    console.error('[email-optout] failed to clear opt-out:', (err as Error).message)
  }
}

/**
 * True if this email has opted out from this practice.
 *
 * Fails open (returns false on DB error or missing table) — same posture
 * as SMS opt-out: we'd rather deliver an expected intake email than
 * silently drop one on a blip.
 */
export async function isEmailOptedOut(
  practiceId: string,
  email: string,
): Promise<boolean> {
  const e = normalize(email)
  if (!e) return false
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM email_opt_outs
        WHERE practice_id = $1 AND email = $2
        LIMIT 1`,
      [practiceId, e],
    )
    return rows.length > 0
  } catch (err) {
    console.error('[email-optout] isEmailOptedOut check failed:', (err as Error).message)
    return false
  }
}
