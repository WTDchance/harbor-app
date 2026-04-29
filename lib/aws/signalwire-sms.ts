// lib/aws/signalwire-sms.ts
//
// Wave 50 — SignalWire SMS appointment reminder pipeline send wrapper.
//
// This sits ABOVE the lower-level lib/aws/signalwire.sendSMS (which
// already handles the LaML REST call + sms_opt_outs read). Callers of
// this wrapper get four extra guarantees that the appointment-reminder
// pipeline needs:
//
//   1. E.164 validation before we waste a SignalWire API call on a
//      malformed number.
//   2. sms_suppression_list check (richer than sms_opt_outs — also
//      covers hard bounces).
//   3. Per-user SMS preference check
//      (user_notification_preferences.sms_*_enabled).
//   4. Dry-run mode controlled by SMS_LIVE_SEND. When set to anything
//      other than the literal string 'true' we DO NOT hit the SignalWire
//      REST API; we log status='dry_run_skipped' to sms_send_log and
//      audit. This lets us run the pipeline end-to-end in staging today
//      and flip the env var once the SignalWire BAA + A2P 10DLC
//      registration lands.
//
// Every send (live, dry-run, suppressed, or skipped-by-pref) is logged
// to sms_send_log AND audited via auditEhrAccess severity 'info' so the
// HIPAA audit log preserves the full reminder cadence — required by §3
// of the SMS-comms ethics policy.

import { pool } from '@/lib/aws/db'
import { sendSMS as lowLevelSend, type SmsResult } from '@/lib/aws/signalwire'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import type { SmsTemplateCategory } from '@/lib/aws/sms-templates'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SmsAuditEventType =
  | 'sms.reminder.dispatched'
  | 'sms.reminder.dry_run'
  | 'sms.reminder.suppressed'
  | 'sms.reminder.preference_disabled'
  | 'sms.reminder.invalid_number'
  | 'sms.reminder.signalwire_error'
  | 'sms.confirmation.sent'
  | 'sms.cancellation.sent'
  | 'sms.cancellation_fill.sent'
  | 'sms.two_factor.sent'

export interface SendSmsArgs {
  to: string
  body: string
  practice_id: string
  audit_event_type: SmsAuditEventType
  /** When omitted defaults to env-driven SMS_LIVE_SEND check. */
  dry_run?: boolean

  // Optional context for sms_send_log row + audit details
  appointment_id?: string | null
  patient_id?: string | null
  user_id?: string | null
  template_category?: SmsTemplateCategory | null
  reminder_threshold?: '24h' | '2h' | '30min' | null
  // Which preference column to check (null = no per-user gate).
  preference_column?:
    | 'sms_appointment_reminders_enabled'
    | 'sms_cancellation_fill_enabled'
    | 'sms_two_factor_enabled'
    | null
}

export type SendSmsResult =
  | { ok: true; sid: string | null; status: 'sent' | 'dry_run_skipped' }
  | {
      ok: false
      sid: null
      status:
        | 'suppressed'
        | 'preference_disabled'
        | 'invalid_number'
        | 'signalwire_error'
        | 'misconfigured'
      reason: string
    }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extra-strict E.164: leading +, then 8-15 digits. */
function isE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone)
}

/** SMS_LIVE_SEND must be the literal string "true" to enable real sends. */
function liveSendEnabled(): boolean {
  return (process.env.SMS_LIVE_SEND || '').toLowerCase() === 'true'
}

async function isSuppressed(practiceId: string, phone: string): Promise<boolean> {
  try {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM sms_suppression_list
        WHERE practice_id = $1
          AND phone = $2
          AND cleared_at IS NULL
        LIMIT 1`,
      [practiceId, phone],
    )
    return (rowCount ?? 0) > 0
  } catch (err) {
    console.error('[signalwire-sms] suppression check failed:', (err as Error).message)
    // Fail open — table-missing in a fresh env shouldn't break the pipeline.
    return false
  }
}

async function isPreferenceDisabled(
  userId: string | null | undefined,
  column: SendSmsArgs['preference_column'],
): Promise<boolean> {
  if (!userId || !column) return false
  try {
    const { rows } = await pool.query(
      `SELECT ${column} AS pref
         FROM user_notification_preferences
        WHERE user_id = $1
        LIMIT 1`,
      [userId],
    )
    if (rows.length === 0) return false // default opt-in (column DEFAULT TRUE)
    return rows[0].pref === false
  } catch (err) {
    console.error('[signalwire-sms] pref check failed:', (err as Error).message)
    return false
  }
}

async function logSend(args: {
  practice_id: string
  appointment_id?: string | null
  patient_id?: string | null
  to: string
  direction: 'outbound'
  template_category?: SmsTemplateCategory | null
  reminder_threshold?: SendSmsArgs['reminder_threshold']
  body: string
  status: string
  signalwire_sid?: string | null
  audit_event_type: SmsAuditEventType
  details?: Record<string, unknown>
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO sms_send_log (
         practice_id, appointment_id, patient_id, to_phone,
         direction, template_category, reminder_threshold,
         body, status, signalwire_sid, audit_event_type, details
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
      [
        args.practice_id,
        args.appointment_id ?? null,
        args.patient_id ?? null,
        args.to,
        args.direction,
        args.template_category ?? null,
        args.reminder_threshold ?? null,
        args.body.slice(0, 1000),
        args.status,
        args.signalwire_sid ?? null,
        args.audit_event_type,
        JSON.stringify(args.details ?? {}),
      ],
    )
  } catch (err) {
    console.error('[signalwire-sms] sms_send_log insert failed:', (err as Error).message)
  }
}

async function audit(
  practiceId: string,
  eventType: SmsAuditEventType,
  resourceId: string | null,
  details: Record<string, unknown>,
): Promise<void> {
  // System-level (no Cognito user) — auditEhrAccess requires an
  // ApiAuthContext, so cron/system paths use auditSystemEvent (which
  // writes to the same audit_logs table at severity 'info').
  await auditSystemEvent({
    action: eventType,
    severity: 'info',
    practiceId,
    resourceType: 'sms',
    resourceId,
    details,
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a single SMS via SignalWire with full pipeline guardrails.
 *
 * Returns:
 *   { ok: true,  sid, status: 'sent' | 'dry_run_skipped' }
 *   { ok: false, sid: null, status: <reason>, reason }
 *
 * Never throws — every error is caught, logged, audited, and returned
 * as `{ ok: false }` so the cron loop can keep going.
 */
export async function sendSms(args: SendSmsArgs): Promise<SendSmsResult> {
  const baseDetails = {
    appointment_id: args.appointment_id ?? null,
    patient_id: args.patient_id ?? null,
    template_category: args.template_category ?? null,
    reminder_threshold: args.reminder_threshold ?? null,
    body_length: args.body.length,
  }

  // 1. E.164 validation
  if (!isE164(args.to)) {
    await audit(args.practice_id, 'sms.reminder.invalid_number', null, {
      ...baseDetails,
      to_masked: args.to.slice(0, 4) + '…',
    })
    await logSend({
      practice_id: args.practice_id,
      appointment_id: args.appointment_id,
      patient_id: args.patient_id,
      to: args.to,
      direction: 'outbound',
      template_category: args.template_category,
      reminder_threshold: args.reminder_threshold,
      body: args.body,
      status: 'invalid_number',
      audit_event_type: args.audit_event_type,
      details: { reason: 'not_e164' },
    })
    return { ok: false, sid: null, status: 'invalid_number', reason: 'not_e164' }
  }

  // 2. Suppression list
  if (await isSuppressed(args.practice_id, args.to)) {
    await audit(args.practice_id, 'sms.reminder.suppressed', args.appointment_id ?? null, baseDetails)
    await logSend({
      practice_id: args.practice_id,
      appointment_id: args.appointment_id,
      patient_id: args.patient_id,
      to: args.to,
      direction: 'outbound',
      template_category: args.template_category,
      reminder_threshold: args.reminder_threshold,
      body: args.body,
      status: 'suppressed',
      audit_event_type: args.audit_event_type,
      details: { reason: 'on_suppression_list' },
    })
    return { ok: false, sid: null, status: 'suppressed', reason: 'on_suppression_list' }
  }

  // 3. Per-user preference gate
  if (await isPreferenceDisabled(args.user_id, args.preference_column)) {
    await audit(
      args.practice_id,
      'sms.reminder.preference_disabled',
      args.appointment_id ?? null,
      { ...baseDetails, column: args.preference_column },
    )
    await logSend({
      practice_id: args.practice_id,
      appointment_id: args.appointment_id,
      patient_id: args.patient_id,
      to: args.to,
      direction: 'outbound',
      template_category: args.template_category,
      reminder_threshold: args.reminder_threshold,
      body: args.body,
      status: 'preference_disabled',
      audit_event_type: args.audit_event_type,
      details: { column: args.preference_column },
    })
    return {
      ok: false,
      sid: null,
      status: 'preference_disabled',
      reason: `pref:${args.preference_column}`,
    }
  }

  // 4. Dry-run branch
  const dryRun = args.dry_run ?? !liveSendEnabled()
  if (dryRun) {
    await audit(args.practice_id, 'sms.reminder.dry_run', args.appointment_id ?? null, {
      ...baseDetails,
      env_flag: process.env.SMS_LIVE_SEND ?? null,
    })
    await logSend({
      practice_id: args.practice_id,
      appointment_id: args.appointment_id,
      patient_id: args.patient_id,
      to: args.to,
      direction: 'outbound',
      template_category: args.template_category,
      reminder_threshold: args.reminder_threshold,
      body: args.body,
      status: 'dry_run_skipped',
      audit_event_type: args.audit_event_type,
      details: { reason: 'sms_live_send_disabled' },
    })
    return { ok: true, sid: null, status: 'dry_run_skipped' }
  }

  // 5. Live send
  const result: SmsResult = await lowLevelSend({
    to: args.to,
    body: args.body,
    practiceId: args.practice_id,
  })

  if (!result.ok) {
    await audit(args.practice_id, 'sms.reminder.signalwire_error', args.appointment_id ?? null, {
      ...baseDetails,
      reason: result.reason,
      status: 'status' in result ? result.status : null,
    })
    await logSend({
      practice_id: args.practice_id,
      appointment_id: args.appointment_id,
      patient_id: args.patient_id,
      to: args.to,
      direction: 'outbound',
      template_category: args.template_category,
      reminder_threshold: args.reminder_threshold,
      body: args.body,
      status: 'signalwire_error',
      audit_event_type: args.audit_event_type,
      details: { reason: result.reason },
    })
    return {
      ok: false,
      sid: null,
      status: 'signalwire_error',
      reason: result.reason,
    }
  }

  await audit(args.practice_id, args.audit_event_type, args.appointment_id ?? null, {
    ...baseDetails,
    sid: result.sid,
  })
  await logSend({
    practice_id: args.practice_id,
    appointment_id: args.appointment_id,
    patient_id: args.patient_id,
    to: args.to,
    direction: 'outbound',
    template_category: args.template_category,
    reminder_threshold: args.reminder_threshold,
    body: args.body,
    status: 'sent',
    signalwire_sid: result.sid,
    audit_event_type: args.audit_event_type,
  })
  return { ok: true, sid: result.sid || null, status: 'sent' }
}

/**
 * True if SMS_LIVE_SEND is enabled. Useful for the settings UI banner
 * ("Reminders are running in dry-run mode — no SMS will actually send")
 * and for ops dashboards.
 */
export function smsLiveSendEnabled(): boolean {
  return liveSendEnabled()
}
