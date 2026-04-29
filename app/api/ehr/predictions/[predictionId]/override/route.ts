// app/api/ehr/predictions/[predictionId]/override/route.ts
//
// W45 T6 — therapist override on a prediction. Body:
//   { override_score: 0..1 | null, reason?: string }
// Pass null to clear the override.
//
// Captured both as a column update on ehr_patient_predictions and
// as a signal row (signal_kind='prediction_overridden') so W46 ML
// can learn from disagreements.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { predictionId: string } },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const clear = body.override_score === null
  const score = clear ? null : Number(body.override_score)
  if (!clear && (Number.isNaN(score!) || score! < 0 || score! > 1)) {
    return NextResponse.json({ error: 'override_score must be null or 0..1' }, { status: 400 })
  }
  const reason = body.reason ? String(body.reason).slice(0, 500) : null

  // Look up the prediction row first to grab patient_id + kind for the
  // signal write-back.
  const cur = await pool.query(
    `SELECT patient_id, prediction_kind, score::float
       FROM ehr_patient_predictions
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [params.predictionId, ctx.practiceId],
  )
  if (cur.rows.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const row = cur.rows[0]

  await pool.query(
    `UPDATE ehr_patient_predictions
        SET override_score  = $1,
            override_reason = $2,
            override_by     = $3,
            override_at     = CASE WHEN $1 IS NULL THEN NULL ELSE NOW() END
      WHERE id = $4 AND practice_id = $5`,
    [clear ? null : score, clear ? null : reason, ctx.user.id, params.predictionId, ctx.practiceId],
  )

  if (!clear) {
    // Closed-loop signal so W46 ML can learn when the heuristic was wrong.
    await pool.query(
      `INSERT INTO ehr_patient_signals
         (practice_id, patient_id, signal_kind, value, observed_at, source)
       VALUES ($1, $2, 'prediction_overridden', $3::jsonb, NOW(), 'manual_override')
       ON CONFLICT (practice_id, patient_id, signal_kind, observed_at, source)
         DO NOTHING`,
      [
        ctx.practiceId,
        row.patient_id,
        JSON.stringify({
          prediction_id: params.predictionId,
          kind: row.prediction_kind,
          model_score: row.score,
          override_score: score,
          delta: typeof score === 'number' ? score - Number(row.score) : 0,
          reason_provided: !!reason,
        }),
      ],
    )
  }

  await auditEhrAccess({
    ctx,
    action: 'prediction.overridden',
    resourceType: 'prediction',
    resourceId: params.predictionId,
    details: {
      kind: row.prediction_kind,
      cleared: clear,
      reason_provided: !!reason,
    },
  })

  return NextResponse.json({ ok: true })
}
