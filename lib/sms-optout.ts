// SMS opt-out / STOP keyword handling (A2P 10DLC + TCPA compliance).
// Called from /api/sms/inbound before any AI processing, and from
// lib/twilio.sendSMS before any outbound send.

import { supabaseAdmin } from './supabase'

// Carrier-standard stop keywords. Case-insensitive, leading/trailing whitespace ignored.
const STOP_KEYWORDS = new Set([
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
  'OPTOUT',
  'OPT-OUT',
  'OPT OUT',
])

const START_KEYWORDS = new Set([
  'START',
  'YES',
  'UNSTOP',
  'OPTIN',
  'OPT-IN',
  'OPT IN',
])

const HELP_KEYWORDS = new Set(['HELP', 'INFO'])

export type SmsKeywordKind = 'stop' | 'start' | 'help' | null

export function classifyInboundKeyword(body: string): SmsKeywordKind {
  const norm = (body || '').trim().toUpperCase()
  if (STOP_KEYWORDS.has(norm)) return 'stop'
  if (START_KEYWORDS.has(norm)) return 'start'
  if (HELP_KEYWORDS.has(norm)) return 'help'
  return null
}

/**
 * Record an opt-out for this practice/phone pair. Idempotent.
 */
export async function recordOptOut(
  practiceId: string,
  phone: string,
  keyword: string
): Promise<void> {
  try {
    await supabaseAdmin.from('sms_opt_outs').upsert(
      {
        practice_id: practiceId,
        phone,
        keyword: keyword.toUpperCase(),
        source: 'sms_inbound',
      },
      { onConflict: 'practice_id,phone' }
    )
  } catch (err) {
    console.error('[sms-optout] failed to record opt-out:', err)
  }
}

/**
 * Remove an opt-out record so the patient can be texted again.
 */
export async function clearOptOut(practiceId: string, phone: string): Promise<void> {
  try {
    await supabaseAdmin
      .from('sms_opt_outs')
      .delete()
      .eq('practice_id', practiceId)
      .eq('phone', phone)
  } catch (err) {
    console.error('[sms-optout] failed to clear opt-out:', err)
  }
}

/**
 * True if this phone has opted out of SMS from this practice.
 * Safe to fail open (returns false on DB error) — we'd rather deliver a
 * wanted message than silently drop one because of a transient DB blip.
 */
export async function isOptedOut(practiceId: string, phone: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from('sms_opt_outs')
      .select('id')
      .eq('practice_id', practiceId)
      .eq('phone', phone)
      .maybeSingle()
    return !!data
  } catch (err) {
    console.error('[sms-optout] isOptedOut check failed:', err)
    return false
  }
}

/**
 * Canonical confirmation messages (kept short to fit in one SMS segment).
 */
export function stopConfirmationMessage(practiceName: string): string {
  return `You're unsubscribed from ${practiceName}. No more messages will be sent. Reply START to resubscribe.`
}

export function startConfirmationMessage(practiceName: string): string {
  return `You're resubscribed to ${practiceName}. Reply STOP at any time to opt out.`
}

export function helpMessage(practiceName: string, contact?: string | null): string {
  const contactLine = contact ? ` Call ${contact}.` : ''
  return `${practiceName} — for urgent care call 911 or 988 for crisis support.${contactLine} Reply STOP to opt out.`
}
