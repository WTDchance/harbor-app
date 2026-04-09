/**
 * Harbor event spine.
 *
 * One helper, one table (`harbor_events`). Every meaningful thing that
 * happens in the system should flow through here. The helper NEVER throws
 * â if event logging itself fails we swallow the error and log to console,
 * because the event log must never break the request path it's instrumenting.
 *
 * Writes go through `supabaseAdmin` (service role) so RLS is bypassed.
 * Clients can only SELECT their own practice's events.
 */

import { supabaseAdmin } from './supabase';

export type HarborEventSeverity = 'info' | 'warn' | 'error' | 'critical';

export type HarborEventSource =
  | 'twilio'
  | 'vapi'
  | 'webhook'
  | 'intake'
  | 'reconciler'
  | 'manual'
  | 'cron';

/**
 * Canonical event types. Adding a new one is free â just add it here and
 * start calling logEvent with it. The UI in /dashboard/health groups by
 * `severity`, so choose severity carefully.
 */
export type HarborEventType =
  // Call lifecycle
  | 'call.twilio_inbound'
  | 'call.vapi_assistant_request'
  | 'call.vapi_end_of_call'
  | 'call.missing_end_of_call'
  | 'call.extraction_failed'
  | 'call.patient_created'
  | 'call.patient_linked'
  | 'call.patient_not_linked'
  | 'call.crisis_detected'
  | 'call.crisis_alert_sent'
  | 'call.crisis_alert_failed'
  // Intake lifecycle
  | 'intake.token_created'
  | 'intake.sms_sent'
  | 'intake.sms_failed'
  | 'intake.email_sent'
  | 'intake.email_failed'
  | 'intake.opened'
  | 'intake.submitted'
  | 'intake.expired_unopened'
  | 'intake.expired_incomplete'
  // System health
  | 'system.reconciler_run'
  | 'system.webhook_auth_failed'
  | 'system.db_write_failed'
  // Escape hatch for ad-hoc events
  | (string & {});

export interface LogEventInput {
  practiceId: string;
  eventType: HarborEventType;
  severity: HarborEventSeverity;
  source: HarborEventSource;
  message?: string;
  payload?: Record<string, unknown>;
  errorDetail?: string;
  callLogId?: string | null;
  patientId?: string | null;
  intakeTokenId?: string | null;
  /**
   * Dedupe key. If provided, the row will only be inserted if no other row
   * exists with the same (practiceId, eventType, dedupe_key). Only enforced
   * at the DB level for warn/error/critical severity (see migration).
   */
  dedupeKey?: string;
}

/**
 * Fire-and-forget event log. Never throws. Returns the inserted row id on
 * success, `null` on dedupe collision or failure.
 */
export async function logEvent(input: LogEventInput): Promise<string | null> {
  try {
    const payload = {
      ...(input.payload ?? {}),
      ...(input.dedupeKey ? { dedupe_key: input.dedupeKey } : {}),
    };

    const { data, error } = await supabaseAdmin
      .from('harbor_events')
      .insert({
        practice_id: input.practiceId,
        event_type: input.eventType,
        severity: input.severity,
        source: input.source,
        message: input.message ?? null,
        payload,
        error_detail: input.errorDetail ?? null,
        call_log_id: input.callLogId ?? null,
        patient_id: input.patientId ?? null,
        intake_token_id: input.intakeTokenId ?? null,
      })
      .select('id')
      .single();

    if (error) {
      // Unique violation on dedupe key is expected and not an error.
      if (error.code === '23505') return null;
      // eslint-disable-next-line no-console
      console.error('[harbor_events] insert failed', {
        type: input.eventType,
        code: error.code,
        message: error.message,
      });
      return null;
    }

    return data?.id ?? null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[harbor_events] unexpected error', err);
    return null;
  }
}

/**
 * Has an event with this dedupe key already been logged for this practice?
 * Used by the reconciler to avoid N+1 checks before it calls logEvent.
 */
export async function hasEventWithDedupeKey(
  practiceId: string,
  eventType: HarborEventType,
  dedupeKey: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('harbor_events')
    .select('id')
    .eq('practice_id', practiceId)
    .eq('event_type', eventType)
    .eq('payload->>dedupe_key', dedupeKey)
    .limit(1)
    .maybeSingle();

  if (error) return false;
  return !!data;
}
