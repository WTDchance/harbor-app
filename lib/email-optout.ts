// Email opt-out / unsubscribe handling.
// Mirrors lib/sms-optout.ts. Called by lib/email.sendPatientEmail before any
// patient-facing send, and from the dashboard Communication preferences toggle.

import { supabaseAdmin } from './supabase'

function normalize(email: string): string {
  return (email || '').trim().toLowerCase()
}

export type EmailOptOutSource = 'dashboard' | 'inbound' | 'api' | 'bounce'

/**
 * Record an opt-out for this practice/email pair. Idempotent.
 */
export async function recordEmailOptOut(
  practiceId: string,
  email: string,
  source: EmailOptOutSource = 'dashboard',
  keyword?: string
): Promise<void> {
  const e = normalize(email)
  if (!e) return
  try {
    await supabaseAdmin.from('email_opt_outs').upsert(
      {
        practice_id: practiceId,
        email: e,
        source,
        keyword: keyword?.toUpperCase() ?? null,
      },
      { onConflict: 'practice_id,email' }
    )
  } catch (err) {
    console.error('[email-optout] failed to record opt-out:', err)
  }
}

/**
 * Remove an opt-out record so the patient can receive email again.
 */
export async function clearEmailOptOut(
  practiceId: string,
  email: string
): Promise<void> {
  const e = normalize(email)
  if (!e) return
  try {
    await supabaseAdmin
      .from('email_opt_outs')
      .delete()
      .eq('practice_id', practiceId)
      .eq('email', e)
  } catch (err) {
    console.error('[email-optout] failed to clear opt-out:', err)
  }
}

/**
 * True if this email has opted out from this practice.
 * Fails open (returns false on DB error) — same posture as SMS opt-out: we'd
 * rather deliver an expected intake email than silently drop one on a blip.
 */
export async function isEmailOptedOut(
  practiceId: string,
  email: string
): Promise<boolean> {
  const e = normalize(email)
  if (!e) return false
  try {
    const { data } = await supabaseAdmin
      .from('email_opt_outs')
      .select('id')
      .eq('practice_id', practiceId)
      .eq('email', e)
      .maybeSingle()
    return !!data
  } catch (err) {
    console.error('[email-optout] isEmailOptedOut check failed:', err)
    return false
  }
}
