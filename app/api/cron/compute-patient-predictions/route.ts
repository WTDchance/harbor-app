// app/api/cron/compute-patient-predictions/route.ts
//
// W45 T2 — daily compute of heuristic predictions across every active
// patient. Runs after /api/cron/ingest-patient-signals so the signal
// stream is fresh.
//
// Per pass:
//   1. Find every practice with active patients.
//   2. For each (practice, patient): run the heuristic library and
//      UPSERT the prediction row(s).
//   3. Skip discharged patients.
//
// Per-appointment no_show predictions are ALSO computed inline by the
// appointments POST route (W45 T3) and by the reminder-send pipeline,
// so the cron is the safety net (recomputes once a day so a stale
// prediction doesn't go stale forever).

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { assertCronAuthorized } from '@/lib/cron-auth'
import { computeNoShow, NO_SHOW_MODEL_VERSION } from '@/lib/aws/ehr/predictions/no-show'
import { computeEngagement, ENGAGEMENT_MODEL_VERSION } from '@/lib/aws/ehr/predictions/engagement'
import { upsertPrediction } from '@/lib/aws/ehr/predictions/upsert'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const unauthorized = assertCronAuthorized(req)
  if (unauthorized) return unauthorized

  const today = new Date().toISOString().slice(0, 10)
  try {
    const { rows: prior } = await pool.query(
      `SELECT 1 FROM audit_logs
        WHERE action = 'predictions.computed'
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

  // Active patients: anyone with ≥1 appointment in the last 90d or
  // an upcoming scheduled appointment, scoped per practice.
  const { rows: targets } = await pool.query<{ practice_id: string; patient_id: string }>(
    `SELECT DISTINCT a.practice_id, a.patient_id
       FROM appointments a
      WHERE a.patient_id IS NOT NULL
        AND (
          a.scheduled_for >= NOW() - INTERVAL '90 days'
          OR (a.scheduled_for >= NOW() AND a.status IN ('scheduled','confirmed'))
        )`,
  )

  let computed = 0
  let errors = 0

  // Patient-level kinds first.
  for (const t of targets) {
    try {
      const eng = await computeEngagement(t.practice_id, t.patient_id)
      await upsertPrediction({
        practice_id: t.practice_id,
        patient_id: t.patient_id,
        kind: 'engagement_score',
        score: eng.score,
        factors: eng.factors,
        model_version: ENGAGEMENT_MODEL_VERSION,
      })
      // Dropout risk is the inverse projection of engagement, but we
      // store both rows so the UI can read either kind directly. The
      // factors are shared.
      await upsertPrediction({
        practice_id: t.practice_id,
        patient_id: t.patient_id,
        kind: 'dropout_risk',
        score: 1 - eng.score,
        factors: { ...eng.factors, summary: `Inverse of engagement: ${eng.factors.summary}` },
        model_version: ENGAGEMENT_MODEL_VERSION,
      })
      computed += 2
    } catch (err) {
      console.error('[compute-predictions] engagement failed:', t.patient_id, (err as Error).message)
      errors++
    }
  }

  // Per-appointment no_show for upcoming appointments in the next 14 days.
  const { rows: upcoming } = await pool.query<{
    practice_id: string
    patient_id: string
    id: string
  }>(
    `SELECT a.practice_id, a.patient_id, a.id
       FROM appointments a
      WHERE a.patient_id IS NOT NULL
        AND a.status IN ('scheduled','confirmed')
        AND a.scheduled_for >= NOW()
        AND a.scheduled_for <= NOW() + INTERVAL '14 days'`,
  )

  for (const a of upcoming) {
    try {
      const ns = await computeNoShow(a.practice_id, a.patient_id, a.id)
      await upsertPrediction({
        practice_id: a.practice_id,
        patient_id: a.patient_id,
        appointment_id: a.id,
        kind: 'no_show',
        score: ns.score,
        factors: ns.factors,
        model_version: NO_SHOW_MODEL_VERSION,
      })
      computed++
    } catch (err) {
      console.error('[compute-predictions] no_show failed:', a.id, (err as Error).message)
      errors++
    }
  }

  await auditSystemEvent({
    action: 'predictions.computed',
    resourceType: 'cron',
    severity: errors > 0 ? 'warn' : 'info',
    details: {
      patients_scanned: targets.length,
      upcoming_appointments_scored: upcoming.length,
      predictions_written: computed,
      errors,
    },
  })

  return NextResponse.json({
    ok: true,
    patients_scanned: targets.length,
    upcoming_appointments_scored: upcoming.length,
    predictions_written: computed,
    errors,
  })
}
