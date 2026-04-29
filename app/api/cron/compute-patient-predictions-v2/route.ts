// app/api/cron/compute-patient-predictions-v2/route.ts
//
// W50 D3 — daily compute pass over the v2 prediction layer. Reads from
// patients + appointments + ehr_call_signals + ehr_payments to build
// the rolling aggregate, then evaluates lib/ehr/predictions.ts on each.
//
// Uses inputs_hash to skip rows whose features haven't changed (the
// predictions table has a unique index on (practice_id, patient_id,
// inputs_hash) so duplicate writes are no-ops).

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { assertCronAuthorized } from '@/lib/cron-auth'
import { predict, type PatientFeatures } from '@/lib/ehr/predictions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface PracticePatientRow {
  practice_id: string
  patient_id: string
}

export async function GET(req: NextRequest) {
  const unauth = assertCronAuthorized(req)
  if (unauth) return unauth

  const { rows: targets } = await pool.query<PracticePatientRow>(
    `SELECT p.practice_id, p.id AS patient_id
       FROM patients p
      WHERE p.patient_status IN ('inquiry','intake','active','paused')`,
  ).catch(() => ({ rows: [] as PracticePatientRow[] }))

  let computed = 0
  let skipped = 0
  let failed = 0

  for (const t of targets) {
    try {
      const features = await loadFeatures(t.practice_id, t.patient_id)
      const pred = predict(features)

      // Refresh the rolling aggregate (UPSERT).
      await pool.query(
        `INSERT INTO ehr_patient_signal_aggregate
           (patient_id, practice_id, total_call_signals, last_sentiment, last_urgency,
            last_call_at, appointments_kept, appointments_no_show, appointments_cancelled,
            payments_on_time, payments_late, current_balance_cents, intake_form_completion_pct,
            consecutive_kept, last_no_show_at, last_appointment_at,
            last_call_hesitation_score, inputs_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (patient_id) DO UPDATE SET
           total_call_signals = EXCLUDED.total_call_signals,
           last_sentiment = EXCLUDED.last_sentiment,
           last_urgency = EXCLUDED.last_urgency,
           last_call_at = EXCLUDED.last_call_at,
           appointments_kept = EXCLUDED.appointments_kept,
           appointments_no_show = EXCLUDED.appointments_no_show,
           appointments_cancelled = EXCLUDED.appointments_cancelled,
           payments_on_time = EXCLUDED.payments_on_time,
           payments_late = EXCLUDED.payments_late,
           current_balance_cents = EXCLUDED.current_balance_cents,
           intake_form_completion_pct = EXCLUDED.intake_form_completion_pct,
           consecutive_kept = EXCLUDED.consecutive_kept,
           last_no_show_at = EXCLUDED.last_no_show_at,
           last_appointment_at = EXCLUDED.last_appointment_at,
           last_call_hesitation_score = EXCLUDED.last_call_hesitation_score,
           inputs_hash = EXCLUDED.inputs_hash`,
        [
          t.patient_id, t.practice_id,
          features._totalCallSignals,
          features.last_sentiment,
          features._lastUrgency,
          features._lastCallAt,
          features.appointments_kept,
          features.appointments_no_show,
          features.appointments_cancelled,
          features.payments_on_time,
          features.payments_late,
          features.current_balance_cents,
          features._intakePct,
          features.consecutive_kept,
          features._lastNoShowAt,
          features._lastAppointmentAt,
          features.last_call_hesitation_score,
          pred.inputs_hash,
        ],
      )

      // ON CONFLICT DO NOTHING — same inputs_hash means no change.
      const ins = await pool.query(
        `INSERT INTO ehr_patient_predictions_v2
           (practice_id, patient_id, no_show_prob, dropout_prob, payment_risk_score,
            churn_score, composite_severity, factors, model_version, inputs_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
         ON CONFLICT (practice_id, patient_id, inputs_hash) DO NOTHING
         RETURNING id`,
        [
          t.practice_id, t.patient_id,
          pred.no_show_prob, pred.dropout_prob, pred.payment_risk_score, pred.churn_score,
          pred.composite_severity, JSON.stringify(pred.factors),
          pred.model_version, pred.inputs_hash,
        ],
      )
      if (ins.rows.length === 0) skipped += 1
      else computed += 1
    } catch (e) {
      failed += 1
      console.error('[compute-patient-predictions-v2]', t.patient_id, (e as Error).message)
    }
  }

  await auditSystemEvent({
    action: 'predictions.computed',
    severity: 'info',
    details: {
      flavor: 'v2-heuristic-1',
      total_patients: targets.length,
      computed,
      skipped_unchanged: skipped,
      failed,
    },
  })

  return NextResponse.json({ ok: true, total: targets.length, computed, skipped, failed })
}

// Internal feature shape carries a few private fields (prefixed with _)
// the cron uses to upsert into ehr_patient_signal_aggregate.
type FullFeatures = PatientFeatures & {
  _totalCallSignals: number
  _lastUrgency: number | null
  _lastCallAt: Date | null
  _intakePct: number
  _lastNoShowAt: Date | null
  _lastAppointmentAt: Date | null
}

async function loadFeatures(practiceId: string, patientId: string): Promise<FullFeatures> {
  // Appointment counts.
  const apt = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'completed')::int AS kept,
       COUNT(*) FILTER (WHERE status = 'no_show')::int   AS no_show,
       COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
       MAX(scheduled_for) FILTER (WHERE status = 'no_show') AS last_no_show_at,
       MAX(scheduled_for)                                   AS last_appointment_at
       FROM appointments
      WHERE practice_id = $1 AND patient_id = $2`,
    [practiceId, patientId],
  ).catch(() => ({ rows: [{ kept: 0, no_show: 0, cancelled: 0, last_no_show_at: null, last_appointment_at: null }] }))

  // Recent (60d) no-shows + 30d no-call-no-show.
  const recent = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'no_show' AND scheduled_for >= NOW() - INTERVAL '60 days')::int AS recent_no_show_count,
       BOOL_OR(status = 'no_show' AND scheduled_for >= NOW() - INTERVAL '30 days') AS has_ncns_30d,
       BOOL_AND(scheduled_for < NOW() - INTERVAL '60 days') AS no_appt_60d_when_any
       FROM appointments
      WHERE practice_id = $1 AND patient_id = $2`,
    [practiceId, patientId],
  ).catch(() => ({ rows: [{ recent_no_show_count: 0, has_ncns_30d: false, no_appt_60d_when_any: true }] }))

  // Consecutive-kept run from the last appointment going backward.
  const consec = await pool.query(
    `WITH ordered AS (
       SELECT status, ROW_NUMBER() OVER (ORDER BY scheduled_for DESC) AS rn
         FROM appointments
        WHERE practice_id = $1 AND patient_id = $2
          AND status IN ('completed','no_show','cancelled')
     )
     SELECT COUNT(*)::int AS run
       FROM ordered
      WHERE rn <= COALESCE((SELECT MIN(rn) FROM ordered WHERE status <> 'completed') - 1, 9999)`,
    [practiceId, patientId],
  ).catch(() => ({ rows: [{ run: 0 }] }))

  // Latest call signal sentiment + hesitation.
  const callSignals = await pool.query(
    `WITH last_call AS (
       SELECT call_id, MAX(extracted_at) AS at
         FROM ehr_call_signals
        WHERE practice_id = $1 AND patient_id = $2
        GROUP BY call_id
        ORDER BY at DESC
        LIMIT 1
     )
     SELECT s.signal_type, s.signal_value, s.confidence,
            (SELECT at FROM last_call) AS at,
            (SELECT COUNT(*) FROM ehr_call_signals
               WHERE practice_id = $1 AND patient_id = $2)::int AS total_count
       FROM ehr_call_signals s
      WHERE s.practice_id = $1 AND s.patient_id = $2
        AND s.call_id = (SELECT call_id FROM last_call)`,
    [practiceId, patientId],
  ).catch(() => ({ rows: [] as any[] }))

  let lastSentiment: number | null = null
  let lastUrgency: number | null = null
  let lastHesitation: number | null = null
  let totalSignals = 0
  let lastCallAt: Date | null = null
  for (const r of callSignals.rows) {
    totalSignals = r.total_count ?? totalSignals
    if (r.at && !lastCallAt) lastCallAt = new Date(r.at)
    if (r.signal_type === 'sentiment_positive') lastSentiment = Math.max(lastSentiment ?? -2, Number(r.signal_value) || 0.5)
    else if (r.signal_type === 'sentiment_negative') lastSentiment = Math.min(lastSentiment ?? 2, Number(r.signal_value) || -0.5)
    if (r.signal_type === 'urgency_high') lastUrgency = Math.max(lastUrgency ?? 0, 0.85)
    else if (r.signal_type === 'urgency_medium') lastUrgency = Math.max(lastUrgency ?? 0, 0.55)
    else if (r.signal_type === 'urgency_low') lastUrgency = Math.max(lastUrgency ?? 0, 0.25)
    if (r.signal_type === 'hesitation') {
      const v = Number(r.signal_value)
      if (Number.isFinite(v)) lastHesitation = Math.min(1, v > 5 ? Math.min(1, v / 10) : v)
    }
  }

  // Payment + balance — best-effort across schemas; missing tables yield zeros.
  const pay = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE COALESCE(paid_at, NULL) IS NOT NULL)::int AS on_time,
       COUNT(*) FILTER (WHERE COALESCE(is_late, false) = true)::int     AS late,
       COALESCE(SUM(amount_cents) FILTER (WHERE COALESCE(paid_at, NULL) IS NULL), 0)::int AS balance_cents
       FROM ehr_payments
      WHERE practice_id = $1 AND patient_id = $2`,
    [practiceId, patientId],
  ).catch(() => ({ rows: [{ on_time: 0, late: 0, balance_cents: 0 }] }))

  // Intake completion %.
  const intake = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'completed')::int AS done,
       COUNT(*)::int AS total
       FROM intake_forms
      WHERE practice_id = $1 AND patient_id = $2`,
    [practiceId, patientId],
  ).catch(() => ({ rows: [{ done: 0, total: 0 }] }))

  const intakePct = (intake.rows[0]?.total ?? 0) > 0
    ? (intake.rows[0].done / intake.rows[0].total) * 100
    : 0

  return {
    recent_no_show_count: recent.rows[0]?.recent_no_show_count ?? 0,
    consecutive_kept: consec.rows[0]?.run ?? 0,
    last_call_hesitation_score: lastHesitation,
    last_sentiment: lastSentiment,
    appointments_kept: apt.rows[0]?.kept ?? 0,
    appointments_no_show: apt.rows[0]?.no_show ?? 0,
    appointments_cancelled: apt.rows[0]?.cancelled ?? 0,
    payments_on_time: pay.rows[0]?.on_time ?? 0,
    payments_late: pay.rows[0]?.late ?? 0,
    current_balance_cents: pay.rows[0]?.balance_cents ?? 0,
    has_no_call_no_show_in_last_30d: !!recent.rows[0]?.has_ncns_30d,
    no_appointment_in_last_60d: !!recent.rows[0]?.no_appt_60d_when_any,

    _totalCallSignals: totalSignals,
    _lastUrgency: lastUrgency,
    _lastCallAt: lastCallAt,
    _intakePct: intakePct,
    _lastNoShowAt: apt.rows[0]?.last_no_show_at ? new Date(apt.rows[0].last_no_show_at) : null,
    _lastAppointmentAt: apt.rows[0]?.last_appointment_at ? new Date(apt.rows[0].last_appointment_at) : null,
  }
}
