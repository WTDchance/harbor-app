// Harbor data retention cron — HIPAA §164.530(j).
//
// Enforces the 90-day call/sms retention + 365-day audit-log retention.
// Bearer CRON_SECRET. Idempotent per-day via audit_logs lookup so a misfire
// doesn't double-delete.
//
// AWS canonical schema notes:
//   call_logs.created_at → started_at filter equivalent.
//   sms_conversations table may not exist on every cluster — try/catch,
//   skip with zero-count if missing.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { assertCronAuthorized } from '@/lib/cron-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CALL_LOG_RETENTION_DAYS = 90
const SMS_RETENTION_DAYS = 90
const AUDIT_LOG_RETENTION_DAYS = 365

export async function GET(req: NextRequest) {
  const unauthorized = assertCronAuthorized(req)
  if (unauthorized) return unauthorized

  const today = new Date().toISOString().slice(0, 10)
  const results: Record<string, number> = {}

  // Idempotency: only run once per UTC day. The marker is the audit_logs row
  // we'll write at the end of a successful run.
  try {
    const { rows: prior } = await pool.query(
      `SELECT 1 FROM audit_logs
        WHERE action = 'cron.data-retention.run'
          AND timestamp >= $1::timestamptz
        LIMIT 1`,
      [`${today}T00:00:00Z`],
    )
    if (prior[0]) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'Already ran today' })
    }
  } catch {
    // audit_logs unreachable — proceed defensively rather than block.
  }

  // 1. call_logs older than 90d. AWS canonical: started_at as the timeline.
  const callCutoff = new Date()
  callCutoff.setDate(callCutoff.getDate() - CALL_LOG_RETENTION_DAYS)
  try {
    const { rows: deleted } = await pool.query(
      `DELETE FROM call_logs
        WHERE COALESCE(started_at, created_at) < $1
        RETURNING id`,
      [callCutoff.toISOString()],
    )
    results.call_logs_deleted = deleted.length
  } catch (err) {
    console.error('[data-retention] call_logs delete error:', (err as Error).message)
    results.call_logs_error = 1
  }

  // 2. sms_conversations older than 90d (table may not exist).
  const smsCutoff = new Date()
  smsCutoff.setDate(smsCutoff.getDate() - SMS_RETENTION_DAYS)
  try {
    const { rows: deleted } = await pool.query(
      `DELETE FROM sms_conversations
        WHERE last_message_at < $1
        RETURNING id`,
      [smsCutoff.toISOString()],
    )
    results.sms_conversations_deleted = deleted.length
  } catch (err) {
    const m = (err as Error).message
    if (/relation .* does not exist/i.test(m)) {
      results.sms_conversations_skipped = 1
    } else {
      console.error('[data-retention] sms_conversations delete error:', m)
      results.sms_conversations_error = 1
    }
  }

  // 3. audit_logs older than 365d.
  const auditCutoff = new Date()
  auditCutoff.setDate(auditCutoff.getDate() - AUDIT_LOG_RETENTION_DAYS)
  try {
    const { rows: deleted } = await pool.query(
      `DELETE FROM audit_logs
        WHERE timestamp < $1
        RETURNING id`,
      [auditCutoff.toISOString()],
    )
    results.audit_logs_deleted = deleted.length
  } catch (err) {
    console.error('[data-retention] audit_logs delete error:', (err as Error).message)
    results.audit_logs_error = 1
  }

  // 4. Mark the run.
  auditSystemEvent({
    action: 'cron.data-retention.run',
    details: {
      retention_days: {
        call_logs: CALL_LOG_RETENTION_DAYS,
        sms_conversations: SMS_RETENTION_DAYS,
        audit_logs: AUDIT_LOG_RETENTION_DAYS,
      },
      deleted: results,
    },
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    retention_days: {
      call_logs: CALL_LOG_RETENTION_DAYS,
      sms_conversations: SMS_RETENTION_DAYS,
      audit_logs: AUDIT_LOG_RETENTION_DAYS,
    },
    deleted: results,
  })
}
