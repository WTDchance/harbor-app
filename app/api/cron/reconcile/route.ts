/**
 * Harbor reconciler.
 *
 * Runs on a schedule (Railway cron, every 5 min). Each run:
 *   1. Flags call_logs rows with a transcript â¥ 20s but no patient_id
 *      older than 10 minutes â `call.patient_not_linked` (error).
 *   2. Flags Twilio inbound events with no corresponding call_log after
 *      10 minutes â `call.missing_end_of_call` (critical).
 *   3. Flags intake tokens 7 days old with no opened_at â `intake.expired_unopened` (warn).
 *   4. Flags intake tokens opened but not completed after 72h â `intake.expired_incomplete` (warn).
 *   5. Flags crisis_detected call_logs with no `call.crisis_alert_sent`
 *      event within 2 min â `call.crisis_alert_failed` (critical).
 *   6. Sends SMS + email to practice owners for unresolved CRITICAL events
 *      (rate-limited via dedupe key).
 *   7. Emits `system.reconciler_run` with the totals.
 *
 * Protected by the shared cron auth helper — accepts either an
 * `Authorization: Bearer <secret>` or `x-cron-secret: <secret>` header
 * matching either `CRON_SECRET` or (legacy) `RECONCILER_SECRET`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { logEvent, hasEventWithDedupeKey } from '@/lib/events';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { sendSMS as signalwireSendSMS } from '@/lib/aws/signalwire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Wave 27e: Twilio swapped for SignalWire (lib/aws/signalwire). The
// signalwireConfigured() guard inside sendSMS lets the call no-op
// quietly if env vars are absent in dev/staging.

interface ReconcileCounts {
  orphan_patients: number;
  missing_end_of_call: number;
  expired_unopened: number;
  expired_incomplete: number;
  crisis_alert_failed: number;
  owner_alerts_sent: number;
}

export async function GET(req: NextRequest) {
  const unauthorized = assertCronAuthorized(req);
  if (unauthorized) return unauthorized;

  const counts: ReconcileCounts = {
    orphan_patients: 0,
    missing_end_of_call: 0,
    expired_unopened: 0,
    expired_incomplete: 0,
    crisis_alert_failed: 0,
    owner_alerts_sent: 0,
  };

  try {
    counts.orphan_patients = await checkOrphanPatients();
    counts.missing_end_of_call = await checkMissingEndOfCall();
    counts.expired_unopened = await checkExpiredUnopenedIntakes();
    counts.expired_incomplete = await checkExpiredIncompleteIntakes();
    counts.crisis_alert_failed = await checkCrisisAlertFailures();
    counts.owner_alerts_sent = await sendOwnerAlerts();

    // Emit the summary event for every active practice so each has a
    // visible "reconciler is running" heartbeat in their health page.
    const { data: practices } = await supabaseAdmin
      .from('practices')
      .select('id');

    for (const p of practices ?? []) {
      await logEvent({
        practiceId: p.id,
        eventType: 'system.reconciler_run',
        severity: 'info',
        source: 'reconciler',
        message: 'Reconciler run complete',
        payload: { ...counts, run_at: new Date().toISOString() },
      });
    }

    // Piggyback data retention on the reconciler schedule. The retention
    // endpoint dedupes via daily event key, so this is safe to call every
    // 5 minutes — it only actually deletes once per day.
    let retentionResult: any = null;
    try {
      const base = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com';
      const headers: Record<string, string> = {};
      if (process.env.CRON_SECRET) headers['Authorization'] = `Bearer ${process.env.CRON_SECRET}`;
      else if (process.env.RECONCILER_SECRET) headers['x-cron-secret'] = process.env.RECONCILER_SECRET;
      const res = await fetch(`${base}/api/cron/data-retention`, { headers });
      retentionResult = await res.json();
    } catch (err) {
      console.error('[reconciler] data-retention call failed', err);
    }

    return NextResponse.json({ ok: true, counts, retention: retentionResult });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[reconciler] fatal', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function checkOrphanPatients(): Promise<number> {
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: orphans } = await supabaseAdmin
    .from('call_logs')
    .select('id, practice_id, patient_phone, duration_seconds, created_at, transcript')
    .is('patient_id', null)
    .gte('duration_seconds', 20)
    .gte('created_at', oneDayAgo)
    .lte('created_at', tenMinAgo);

  let count = 0;
  for (const row of orphans ?? []) {
    if (!row.transcript || row.transcript.length < 20) continue;
    const dedupeKey = `orphan:${row.id}`;
    const already = await hasEventWithDedupeKey(
      row.practice_id,
      'call.patient_not_linked',
      dedupeKey,
    );
    if (already) continue;

    await logEvent({
      practiceId: row.practice_id,
      eventType: 'call.patient_not_linked',
      severity: 'error',
      source: 'reconciler',
      message: `Call with ${row.duration_seconds}s transcript has no linked patient`,
      callLogId: row.id,
      payload: {
        patient_phone: row.patient_phone,
        duration_seconds: row.duration_seconds,
        call_log_created_at: row.created_at,
      },
      dedupeKey,
    });
    count++;
  }
  return count;
}

async function checkMissingEndOfCall(): Promise<number> {
  // Find Twilio inbound events from > 10 min ago with status 'completed'
  // that have no corresponding call_logs row (by twilio_call_sid).
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: twilioEvents } = await supabaseAdmin
    .from('harbor_events')
    .select('id, practice_id, payload, created_at')
    .eq('event_type', 'call.twilio_inbound')
    .eq('payload->>call_status', 'completed')
    .gte('created_at', oneDayAgo)
    .lte('created_at', tenMinAgo);

  let count = 0;
  for (const evt of twilioEvents ?? []) {
    const sid = (evt.payload as any)?.twilio_call_sid;
    if (!sid) continue;

    const { data: match } = await supabaseAdmin
      .from('call_logs')
      .select('id')
      .eq('twilio_call_sid', sid)
      .maybeSingle();

    if (match) continue; // we're good

    const dedupeKey = `missing_eoc:${sid}`;
    const already = await hasEventWithDedupeKey(
      evt.practice_id,
      'call.missing_end_of_call',
      dedupeKey,
    );
    if (already) continue;

    await logEvent({
      practiceId: evt.practice_id,
      eventType: 'call.missing_end_of_call',
      severity: 'critical',
      source: 'reconciler',
      message: `Twilio recorded a completed call but Vapi never delivered an end-of-call report`,
      payload: {
        twilio_call_sid: sid,
        twilio_from: (evt.payload as any)?.from,
        twilio_completed_at: evt.created_at,
      },
      dedupeKey,
    });
    count++;
  }
  return count;
}

async function checkExpiredUnopenedIntakes(): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: stale } = await supabaseAdmin
    .from('intake_tokens')
    .select('id, practice_id, patient_id, patient_phone, patient_email, created_at')
    .is('opened_at', null)
    .lte('created_at', sevenDaysAgo);

  let count = 0;
  for (const row of stale ?? []) {
    const dedupeKey = `intake_unopened:${row.id}`;
    const already = await hasEventWithDedupeKey(
      row.practice_id,
      'intake.expired_unopened',
      dedupeKey,
    );
    if (already) continue;

    await logEvent({
      practiceId: row.practice_id,
      eventType: 'intake.expired_unopened',
      severity: 'warn',
      source: 'reconciler',
      message: `Patient never opened their intake link (7+ days)`,
      intakeTokenId: row.id,
      patientId: row.patient_id ?? undefined,
      payload: {
        patient_phone: row.patient_phone,
        patient_email: row.patient_email,
        sent_at: row.created_at,
      },
      dedupeKey,
    });
    count++;
  }
  return count;
}

async function checkExpiredIncompleteIntakes(): Promise<number> {
  const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

  const { data: stale } = await supabaseAdmin
    .from('intake_tokens')
    .select('id, practice_id, patient_id, opened_at')
    .not('opened_at', 'is', null)
    .is('completed_at', null)
    .lte('opened_at', seventyTwoHoursAgo);

  let count = 0;
  for (const row of stale ?? []) {
    const dedupeKey = `intake_incomplete:${row.id}`;
    const already = await hasEventWithDedupeKey(
      row.practice_id,
      'intake.expired_incomplete',
      dedupeKey,
    );
    if (already) continue;

    await logEvent({
      practiceId: row.practice_id,
      eventType: 'intake.expired_incomplete',
      severity: 'warn',
      source: 'reconciler',
      message: `Patient started intake but abandoned it (72h+)`,
      intakeTokenId: row.id,
      patientId: row.patient_id ?? undefined,
      payload: { opened_at: row.opened_at },
      dedupeKey,
    });
    count++;
  }
  return count;
}

async function checkCrisisAlertFailures(): Promise<number> {
  const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: crises } = await supabaseAdmin
    .from('call_logs')
    .select('id, practice_id, created_at, patient_phone')
    .eq('crisis_detected', true)
    .gte('created_at', oneDayAgo)
    .lte('created_at', twoMinAgo);

  let count = 0;
  for (const call of crises ?? []) {
    // Did we emit a crisis_alert_sent for this call?
    const { data: sent } = await supabaseAdmin
      .from('harbor_events')
      .select('id')
      .eq('call_log_id', call.id)
      .eq('event_type', 'call.crisis_alert_sent')
      .limit(1)
      .maybeSingle();

    if (sent) continue;

    const dedupeKey = `crisis_failed:${call.id}`;
    const already = await hasEventWithDedupeKey(
      call.practice_id,
      'call.crisis_alert_failed',
      dedupeKey,
    );
    if (already) continue;

    await logEvent({
      practiceId: call.practice_id,
      eventType: 'call.crisis_alert_failed',
      severity: 'critical',
      source: 'reconciler',
      message: `Crisis was detected on this call but no alert was sent to the practice`,
      callLogId: call.id,
      payload: { patient_phone: call.patient_phone, call_created_at: call.created_at },
      dedupeKey,
    });
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Owner alerting (rate-limited, critical-only)
// ---------------------------------------------------------------------------

async function sendOwnerAlerts(): Promise<number> {
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  // Find unresolved critical events created in the last 15 min that haven't
  // yet triggered an owner alert (tracked via a sibling event).
  const { data: events } = await supabaseAdmin
    .from('harbor_events')
    .select('id, practice_id, event_type, message, created_at, payload')
    .eq('severity', 'critical')
    .is('resolved_at', null)
    .gte('created_at', fifteenMinAgo);

  if (!events || events.length === 0) return 0;

  const twilioClient = getTwilioClient();
  let sent = 0;

  for (const evt of events) {
    const alertDedupeKey = `owner_alert:${evt.id}`;
    const already = await hasEventWithDedupeKey(
      evt.practice_id,
      'system.reconciler_run', // sentinel type so it doesn't pollute the health page
      alertDedupeKey,
    );
    if (already) continue;

    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('name, owner_phone, owner_email, alert_sms_enabled, alert_email_enabled')
      .eq('id', evt.practice_id)
      .maybeSingle();

    if (!practice) continue;

    const body = `Harbor alert (${practice.name ?? 'your practice'}): ${evt.message ?? evt.event_type}. Open the health page to review.`;

    // SMS via SignalWire (Wave 27e). sendSMS no-ops gracefully when
    // SignalWire env vars are missing — owner alerts still log an event
    // and email path runs independently.
    if (practice.alert_sms_enabled && practice.owner_phone) {
      const result = await signalwireSendSMS({
        to: practice.owner_phone,
        body,
        practiceId: evt.practice_id,
      });
      if (result.ok) {
        sent++;
      } else {
        console.error('[reconciler] owner SMS failed via SignalWire:', result.reason);
      }
    }

    // Email via Resend (best-effort â only if key is set)
    if (
      practice.alert_email_enabled &&
      practice.owner_email &&
      process.env.RESEND_API_KEY &&
      process.env.RESEND_FROM_EMAIL
    ) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL,
            to: practice.owner_email,
            subject: `Harbor alert: ${evt.event_type}`,
            text: body,
          }),
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[reconciler] owner email failed', err);
      }
    }

    // Drop a marker so we don't re-alert for the same event.
    await logEvent({
      practiceId: evt.practice_id,
      eventType: 'system.reconciler_run',
      severity: 'info',
      source: 'reconciler',
      message: `Owner alert dispatched for event ${evt.id}`,
      payload: { original_event_id: evt.id, original_event_type: evt.event_type },
      dedupeKey: alertDedupeKey,
    });
  }

  return sent;
}
