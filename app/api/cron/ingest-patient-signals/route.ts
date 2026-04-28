// app/api/cron/ingest-patient-signals/route.ts
//
// W45 T1 — daily ingestion of patient signals from operational tables
// into the ehr_patient_signals append-only stream.
//
// Idempotent: every INSERT carries an ON CONFLICT DO NOTHING against
// the (practice_id, patient_id, signal_kind, observed_at, source)
// unique key. Re-runs are safe.
//
// Scope: looks at events from the last 90 days on first run, then a
// 7-day overlap window thereafter. Older events are assumed already
// ingested (predictions only weight recency anyway, so missing a row
// from a year ago doesn't move scores).
//
// Failure mode: a failed source (table missing, query timeout) skips
// only that source — the cron continues. The audit_logs row at the
// end records per-source counts so an operator can spot a stuck
// integration.
//
// Auth: shared cron-auth (Bearer or x-cron-secret).

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { assertCronAuthorized } from '@/lib/cron-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const LOOKBACK_DAYS = 7
const FIRST_RUN_DAYS = 90

type IngestResult = { kind: string; inserted: number; error?: string }

async function run(query: string, args: any[]): Promise<number> {
  const res = await pool.query(query, args)
  return res.rowCount ?? 0
}

async function safeRun(label: string, query: string, args: any[]): Promise<IngestResult> {
  try {
    const inserted = await run(query, args)
    return { kind: label, inserted }
  } catch (err) {
    return { kind: label, inserted: 0, error: (err as Error).message }
  }
}

export async function GET(req: NextRequest) {
  const unauthorized = assertCronAuthorized(req)
  if (unauthorized) return unauthorized

  // Idempotency for the cron run itself: already ran today? skip.
  const today = new Date().toISOString().slice(0, 10)
  try {
    const { rows: prior } = await pool.query(
      `SELECT 1 FROM audit_logs
        WHERE action = 'signals.ingested'
          AND timestamp >= $1::timestamptz
        LIMIT 1`,
      [`${today}T00:00:00Z`],
    )
    if (prior[0]) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'already_ran_today' })
    }
  } catch {
    // proceed
  }

  // Detect first-run by looking for any prior signals row.
  const { rows: anySig } = await pool.query(
    `SELECT 1 FROM ehr_patient_signals LIMIT 1`,
  ).catch(() => ({ rows: [] as any[] }))
  const lookbackDays = anySig[0] ? LOOKBACK_DAYS : FIRST_RUN_DAYS
  const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString()

  const results: IngestResult[] = []

  // ---- 1) appointment_kept / no_show / late_cancel / late_arrival ----
  // Source = appointments table. We pull each terminal status as its
  // own signal kind, observed_at = scheduled_for (which is when the
  // outcome was knowable).
  results.push(await safeRun(
    'appointment_kept',
    `INSERT INTO ehr_patient_signals
       (practice_id, patient_id, signal_kind, value, observed_at, source)
     SELECT a.practice_id, a.patient_id, 'appointment_kept',
            jsonb_build_object('appointment_id', a.id,
                               'duration_minutes', a.duration_minutes,
                               'appointment_type', a.appointment_type),
            a.scheduled_for, 'appointments_table'
       FROM appointments a
      WHERE a.status = 'completed'
        AND a.patient_id IS NOT NULL
        AND a.scheduled_for >= $1::timestamptz
     ON CONFLICT (practice_id, patient_id, signal_kind, observed_at, source)
       DO NOTHING`,
    [since],
  ))

  results.push(await safeRun(
    'appointment_no_show',
    `INSERT INTO ehr_patient_signals
       (practice_id, patient_id, signal_kind, value, observed_at, source)
     SELECT a.practice_id, a.patient_id, 'appointment_no_show',
            jsonb_build_object('appointment_id', a.id,
                               'appointment_type', a.appointment_type),
            COALESCE(a.no_show_at, a.scheduled_for),
            'appointments_table'
       FROM appointments a
      WHERE a.status = 'no_show'
        AND a.patient_id IS NOT NULL
        AND a.scheduled_for >= $1::timestamptz
     ON CONFLICT (practice_id, patient_id, signal_kind, observed_at, source)
       DO NOTHING`,
    [since],
  ))

  results.push(await safeRun(
    'appointment_late_cancel',
    `INSERT INTO ehr_patient_signals
       (practice_id, patient_id, signal_kind, value, observed_at, source)
     SELECT a.practice_id, a.patient_id, 'appointment_late_cancel',
            jsonb_build_object('appointment_id', a.id,
                               'cancellation_reason', a.cancellation_reason),
            a.late_canceled_at,
            'appointments_table'
       FROM appointments a
      WHERE a.late_canceled_at IS NOT NULL
        AND a.patient_id IS NOT NULL
        AND a.late_canceled_at >= $1::timestamptz
     ON CONFLICT (practice_id, patient_id, signal_kind, observed_at, source)
       DO NOTHING`,
    [since],
  ))

  // ---- 2) reminder_sent (from appointments.reminder_sent_at) -----------
  results.push(await safeRun(
    'reminder_sent',
    `INSERT INTO ehr_patient_signals
       (practice_id, patient_id, signal_kind, value, observed_at, source)
     SELECT a.practice_id, a.patient_id, 'reminder_sent',
            jsonb_build_object('appointment_id', a.id,
                               'scheduled_for', a.scheduled_for),
            a.reminder_sent_at, 'appointments_table'
       FROM appointments a
      WHERE a.reminder_sent_at IS NOT NULL
        AND a.patient_id IS NOT NULL
        AND a.reminder_sent_at >= $1::timestamptz
     ON CONFLICT (practice_id, patient_id, signal_kind, observed_at, source)
       DO NOTHING`,
    [since],
  ))

  results.push(await safeRun(
    'reminder_response',
    `INSERT INTO ehr_patient_signals
       (practice_id, patient_id, signal_kind, value, observed_at, source)
     SELECT a.practice_id, a.patient_id, 'reminder_response',
            jsonb_build_object('appointment_id', a.id,
                               'method', a.confirmation_method),
            a.confirmed_at, 'appointments_table'
       FROM appointments a
      WHERE a.confirmed_at IS NOT NULL
        AND a.patient_id IS NOT NULL
        AND a.confirmed_at >= $1::timestamptz
     ON CONFLICT (practice_id, patient_id, signal_kind, observed_at, source)
       DO NOTHING`,
    [since],
  ))

  // ---- 3) payment_made + payment_late ---------------------------------
  results.push(await safeRun(
    'payment_made',
    `INSERT INTO ehr_patient_signals
       (practice_id, patient_id, signal_kind, value, observed_at, source)
     SELECT p.practice_id, p.patient_id, 'payment_made',
            jsonb_build_object('amount_cents', p.amount_cents,
                               'source_kind', p.source),
            p.received_at, 'ehr_payments'
       FROM ehr_payments p
      WHERE p.patient_id IS NOT NULL
        AND p.received_at >= $1::timestamptz
        AND p.source IN ('patient_stripe','manual_check','manual_cash','manual_card_external')
     ON CONFLICT (practice_id, patient_id, signal_kind, observed_at, source)
       DO NOTHING`,
    [since],
  ))

  results.push(await safeRun(
    'balance_aged',
    `INSERT INTO ehr_patient_signals
       (practice_id, patient_id, signal_kind, value, observed_at, source)
     SELECT i.practice_id, i.patient_id, 'balance_aged',
            jsonb_build_object('invoice_id', i.id,
                               'balance_cents', i.total_cents - i.paid_cents,
                               'days_aged',
                                 EXTRACT(DAY FROM NOW() - i.created_at)::int),
            DATE_TRUNC('day', NOW())::timestamptz,
            'ehr_invoices'
       FROM ehr_invoices i
      WHERE i.patient_id IS NOT NULL
        AND i.status IN ('sent','partial')
        AND i.total_cents - i.paid_cents > 0
        AND i.created_at < NOW() - INTERVAL '14 days'
     ON CONFLICT (practice_id, patient_id, signal_kind, observed_at, source)
       DO NOTHING`,
    [],
  ))

  // ---- 4) portal_login (audit_logs portal.login) -----------------------
  results.push(await safeRun(
    'portal_login',
    `INSERT INTO ehr_patient_signals
       (practice_id, patient_id, signal_kind, value, observed_at, source)
     SELECT al.practice_id,
            (al.details->>'patient_id')::uuid,
            'portal_login',
            jsonb_build_object(),
            al.timestamp, 'audit_logs'
       FROM audit_logs al
      WHERE al.action = 'portal.login'
        AND al.practice_id IS NOT NULL
        AND al.details ? 'patient_id'
        AND al.timestamp >= $1::timestamptz
     ON CONFLICT (practice_id, patient_id, signal_kind, observed_at, source)
       DO NOTHING`,
    [since],
  ))

  // ---- 5) assessment_completed + assessment_score ----------------------
  // outcome_assessments holds PHQ-9 / GAD-7 / etc. Subscale scores live
  // in the row's score columns + total_score. We emit a generic
  // assessment_score signal carrying instrument + score; the no-show
  // heuristic ignores it but the engagement_score uses completion
  // recency.
  results.push(await safeRun(
    'assessment_completed',
    `INSERT INTO ehr_patient_signals
       (practice_id, patient_id, signal_kind, value, observed_at, source)
     SELECT oa.practice_id, oa.patient_id, 'assessment_completed',
            jsonb_build_object('instrument', oa.instrument,
                               'score', COALESCE(oa.total_score, 0)),
            oa.completed_at, 'outcome_assessments'
       FROM outcome_assessments oa
      WHERE oa.patient_id IS NOT NULL
        AND oa.completed_at IS NOT NULL
        AND oa.completed_at >= $1::timestamptz
     ON CONFLICT (practice_id, patient_id, signal_kind, observed_at, source)
       DO NOTHING`,
    [since],
  ))

  // ---- 6) communication_preference_changed ----------------------------
  // Best-effort from audit_logs entries that mention preference updates.
  results.push(await safeRun(
    'communication_preference_changed',
    `INSERT INTO ehr_patient_signals
       (practice_id, patient_id, signal_kind, value, observed_at, source)
     SELECT al.practice_id,
            (al.resource_id)::uuid,
            'communication_preference_changed',
            COALESCE(al.details, '{}'::jsonb),
            al.timestamp, 'audit_logs'
       FROM audit_logs al
      WHERE al.action IN ('patient.updated','patient.communication_preference_set')
        AND al.resource_type = 'patient'
        AND al.resource_id IS NOT NULL
        AND al.practice_id IS NOT NULL
        AND al.timestamp >= $1::timestamptz
        AND (al.details->>'communication_preference') IS NOT NULL
     ON CONFLICT (practice_id, patient_id, signal_kind, observed_at, source)
       DO NOTHING`,
    [since],
  ))

  const total = results.reduce((s, r) => s + r.inserted, 0)
  const errors = results.filter((r) => r.error)

  await auditSystemEvent({
    action: 'signals.ingested',
    resourceType: 'cron',
    severity: errors.length > 0 ? 'warn' : 'info',
    details: {
      total_inserted: total,
      lookback_days: lookbackDays,
      per_kind: results.map((r) => ({ kind: r.kind, inserted: r.inserted, error: r.error || null })),
    },
  })

  return NextResponse.json({
    ok: true,
    total_inserted: total,
    lookback_days: lookbackDays,
    results,
  })
}
