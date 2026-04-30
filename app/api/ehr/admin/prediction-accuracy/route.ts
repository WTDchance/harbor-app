// app/api/ehr/admin/prediction-accuracy/route.ts
//
// W45 T7 — internal feedback on heuristic prediction quality. Returns
// per-kind summary + calibration curve so Harbor can decide when
// heuristics are good enough vs when to invest in ML (W46+).
//
// Outcomes derivation:
//   no_show       — prediction.appointment_id → appointments.status
//                   actual = (status='no_show')
//   dropout_risk  — patient had any kept session in the 30 days AFTER
//                   prediction.computed_at
//                   actual_dropout = (no kept session in next 30d)
//   engagement_score — same backing data as dropout_risk; we report
//                      the same calibration but inverted.
//
// Read-only. No schema. Audits as prediction.viewed surface=accuracy.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type CalibrationBucket = {
  bucket: string       // "0-10%"..."90-100%"
  bucket_low: number
  bucket_high: number
  predicted_count: number
  actual_count: number
  actual_rate: number  // actual_count / predicted_count
}

type KindSummary = {
  kind: string
  windows: Record<'30' | '60' | '90', {
    total_predictions: number
    matured: number       // outcome resolved (slot passed for no_show, 30d window passed for dropout)
    positives_actual: number
    positives_predicted_at_50pct: number
    true_positives: number
    false_positives: number
    false_negatives: number
    true_negatives: number
    precision: number | null
    recall: number | null
    base_rate: number | null
  }>
  calibration: CalibrationBucket[]
  trend: Array<{ week_start: string; predictions: number; positives: number }>
}

function bucketFor(score: number): { idx: number; label: string; low: number; high: number } {
  const idx = Math.min(9, Math.max(0, Math.floor(score * 10)))
  const low = idx * 10
  const high = (idx + 1) * 10
  return { idx, label: `${low}-${high}%`, low, high }
}

function emptyBuckets(): CalibrationBucket[] {
  return Array.from({ length: 10 }, (_, idx) => {
    const low = idx * 10
    const high = (idx + 1) * 10
    return {
      bucket: `${low}-${high}%`,
      bucket_low: low,
      bucket_high: high,
      predicted_count: 0,
      actual_count: 0,
      actual_rate: 0,
    }
  })
}

async function loadNoShow(practiceId: string): Promise<KindSummary> {
  // Predictions are matured once the slot has passed.
  const { rows } = await pool.query<{
    score: string
    is_no_show: boolean
    is_matured: boolean
    computed_at: string
  }>(
    `SELECT pp.score::text,
            (a.status = 'no_show')                   AS is_no_show,
            (a.scheduled_for < NOW())                AS is_matured,
            pp.computed_at::text
       FROM ehr_patient_predictions_v2 pp
       JOIN appointments a ON a.id = pp.appointment_id
      WHERE pp.practice_id = $1
        AND pp.prediction_kind = 'no_show'
        AND pp.computed_at >= NOW() - INTERVAL '90 days'`,
    [practiceId],
  )
  return summarize('no_show', rows.map((r) => ({
    score: Number(r.score),
    actual: !!r.is_no_show,
    matured: !!r.is_matured,
    computed_at: r.computed_at,
  })))
}

async function loadDropout(practiceId: string): Promise<KindSummary> {
  // For each prediction at time T, look forward 30 days. If no kept
  // appointment exists for the patient between T and T+30d, that
  // prediction is "actual_dropout=true".
  const { rows } = await pool.query<{
    score: string
    actual: boolean
    matured: boolean
    computed_at: string
  }>(
    `SELECT pp.score::text,
            (NOT EXISTS (
              SELECT 1 FROM appointments a
               WHERE a.patient_id = pp.patient_id
                 AND a.status = 'completed'
                 AND a.scheduled_for >= pp.computed_at
                 AND a.scheduled_for <= pp.computed_at + INTERVAL '30 days'
            ))                                     AS actual,
            (NOW() >= pp.computed_at + INTERVAL '30 days') AS matured,
            pp.computed_at::text
       FROM ehr_patient_predictions_v2 pp
      WHERE pp.practice_id = $1
        AND pp.prediction_kind = 'dropout_risk'
        AND pp.appointment_id IS NULL
        AND pp.computed_at >= NOW() - INTERVAL '90 days'`,
    [practiceId],
  )
  return summarize('dropout_risk', rows.map((r) => ({
    score: Number(r.score),
    actual: !!r.actual,
    matured: !!r.matured,
    computed_at: r.computed_at,
  })))
}

function summarize(kind: string, rows: Array<{ score: number; actual: boolean; matured: boolean; computed_at: string }>): KindSummary {
  const windows: KindSummary['windows'] = {
    '30': zeroWindow(),
    '60': zeroWindow(),
    '90': zeroWindow(),
  }
  const calibration = emptyBuckets()
  const trendMap = new Map<string, { predictions: number; positives: number }>()

  const now = Date.now()
  for (const r of rows) {
    const ageDays = (now - new Date(r.computed_at).getTime()) / 86_400_000
    for (const w of ['30','60','90'] as const) {
      if (ageDays <= Number(w)) {
        const bucket = windows[w]
        bucket.total_predictions++
        if (r.matured) {
          bucket.matured++
          if (r.actual) bucket.positives_actual++
          const predictedPositive = r.score >= 0.5
          if (predictedPositive) bucket.positives_predicted_at_50pct++
          if (predictedPositive && r.actual)  bucket.true_positives++
          if (predictedPositive && !r.actual) bucket.false_positives++
          if (!predictedPositive && r.actual) bucket.false_negatives++
          if (!predictedPositive && !r.actual) bucket.true_negatives++
        }
      }
    }

    if (r.matured) {
      const b = bucketFor(r.score)
      calibration[b.idx].predicted_count++
      if (r.actual) calibration[b.idx].actual_count++

      // Weekly trend
      const weekStart = new Date(r.computed_at)
      weekStart.setUTCHours(0, 0, 0, 0)
      weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay())
      const key = weekStart.toISOString().slice(0, 10)
      const t = trendMap.get(key) || { predictions: 0, positives: 0 }
      t.predictions++
      if (r.actual) t.positives++
      trendMap.set(key, t)
    }
  }

  for (const w of ['30','60','90'] as const) {
    const b = windows[w]
    b.precision = (b.true_positives + b.false_positives) > 0
      ? b.true_positives / (b.true_positives + b.false_positives) : null
    b.recall = (b.true_positives + b.false_negatives) > 0
      ? b.true_positives / (b.true_positives + b.false_negatives) : null
    b.base_rate = b.matured > 0 ? b.positives_actual / b.matured : null
  }

  for (const c of calibration) {
    c.actual_rate = c.predicted_count > 0 ? c.actual_count / c.predicted_count : 0
  }

  const trend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week_start, v]) => ({ week_start, ...v }))

  return { kind, windows, calibration, trend }
}

function zeroWindow() {
  return {
    total_predictions: 0,
    matured: 0,
    positives_actual: 0,
    positives_predicted_at_50pct: 0,
    true_positives: 0,
    false_positives: 0,
    false_negatives: 0,
    true_negatives: 0,
    precision: null as number | null,
    recall: null as number | null,
    base_rate: null as number | null,
  }
}

export async function GET(_req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const [noShow, dropout] = await Promise.all([
    loadNoShow(ctx.practiceId),
    loadDropout(ctx.practiceId),
  ])

  await auditEhrAccess({
    ctx,
    action: 'prediction.viewed',
    resourceType: 'prediction_accuracy',
    details: {
      surface: 'accuracy_dashboard',
      kinds: ['no_show', 'dropout_risk'],
    },
  })

  return NextResponse.json({ kinds: [noShow, dropout] })
}
