/**
 * Harbor data retention cron — HIPAA §164.530(j)
 *
 * Enforces the 90-day retention policy published in our privacy policy.
 * Runs daily (Railway cron). Each run:
 *   1. Deletes call_logs rows older than 90 days (transcripts + summaries).
 *   2. Deletes sms_conversations with last_message_at older than 90 days.
 *   3. Deletes audit_logs older than 365 days (keep 1 year for compliance).
 *   4. Logs a `system.data_retention_run` event with counts.
 *
 * Related FK behaviour:
 *   - harbor_events.call_log_id  → ON DELETE SET NULL  (events kept, link cleared)
 *   - intake_packets.call_log_id → ON DELETE SET NULL  (packets kept, link cleared)
 *   - patient_arrivals.call_log_id → ON DELETE CASCADE (arrivals removed with call)
 *   - outcome_assessments.call_log_id → ON DELETE CASCADE (assessments removed)
 *
 * Protected by x-cron-secret header (same as reconciler).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { logEvent } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CALL_LOG_RETENTION_DAYS = 90;
const SMS_RETENTION_DAYS = 90;
const AUDIT_LOG_RETENTION_DAYS = 365;

export async function GET(req: NextRequest) {
  // Auth check — same pattern as reconciler
  const secret = req.headers.get('x-cron-secret');
  if (process.env.RECONCILER_SECRET && secret !== process.env.RECONCILER_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, number> = {};

  try {
    // 1. Delete call_logs older than 90 days
    const callCutoff = new Date();
    callCutoff.setDate(callCutoff.getDate() - CALL_LOG_RETENTION_DAYS);
    const { data: deletedCalls, error: callErr } = await supabaseAdmin
      .from('call_logs')
      .delete()
      .lt('created_at', callCutoff.toISOString())
      .select('id');

    if (callErr) {
      console.error('[data-retention] call_logs delete error:', callErr.message);
      results.call_logs_error = 1;
    } else {
      results.call_logs_deleted = deletedCalls?.length ?? 0;
    }

    // 2. Delete sms_conversations older than 90 days
    const smsCutoff = new Date();
    smsCutoff.setDate(smsCutoff.getDate() - SMS_RETENTION_DAYS);
    const { data: deletedSms, error: smsErr } = await supabaseAdmin
      .from('sms_conversations')
      .delete()
      .lt('last_message_at', smsCutoff.toISOString())
      .select('id');

    if (smsErr) {
      console.error('[data-retention] sms_conversations delete error:', smsErr.message);
      results.sms_conversations_error = 1;
    } else {
      results.sms_conversations_deleted = deletedSms?.length ?? 0;
    }

    // 3. Delete audit_logs older than 365 days
    const auditCutoff = new Date();
    auditCutoff.setDate(auditCutoff.getDate() - AUDIT_LOG_RETENTION_DAYS);
    const { data: deletedAudit, error: auditErr } = await supabaseAdmin
      .from('audit_logs')
      .delete()
      .lt('timestamp', auditCutoff.toISOString())
      .select('id');

    if (auditErr) {
      console.error('[data-retention] audit_logs delete error:', auditErr.message);
      results.audit_logs_error = 1;
    } else {
      results.audit_logs_deleted = deletedAudit?.length ?? 0;
    }

    // 4. Log the retention run as a system event (no practice scope)
    await logEvent({
      practiceId: '00000000-0000-0000-0000-000000000000', // system-level event
      eventType: 'system.data_retention_run',
      severity: 'info',
      source: 'cron',
      payload: results,
      dedupeKey: `data-retention-${new Date().toISOString().slice(0, 10)}`,
    });

    return NextResponse.json({
      ok: true,
      retention_days: {
        call_logs: CALL_LOG_RETENTION_DAYS,
        sms_conversations: SMS_RETENTION_DAYS,
        audit_logs: AUDIT_LOG_RETENTION_DAYS,
      },
      deleted: results,
    });
  } catch (err: any) {
    console.error('[data-retention] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Data retention run failed', detail: err.message },
      { status: 500 }
    );
  }
}
