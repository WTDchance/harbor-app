// lib/aws/ehr/predictions/upsert.ts
//
// W45 — UPSERT helper for ehr_patient_predictions. Respects therapist
// overrides: if override_score is set on the existing row, the next
// compute pass updates score/factors (so the underlying recommendation
// keeps moving) but does NOT overwrite the override fields. UI layers
// can decide whether to show the override or the model score.

import { pool } from '@/lib/aws/db'
import type { PredictionResult } from './types'

export async function upsertPrediction(p: PredictionResult): Promise<string> {
  const params: any[] = [
    p.practice_id,
    p.patient_id,
    p.kind,
    p.score,
    JSON.stringify(p.factors),
    p.model_version,
    p.appointment_id ?? null,
  ]

  // Two upsert shapes — one for per-appointment rows, one for
  // patient-level rows. The unique partial indexes on the table
  // require this split.
  if (p.appointment_id) {
    const res = await pool.query(
      `INSERT INTO ehr_patient_predictions
         (practice_id, patient_id, prediction_kind, score, factors,
          model_version, appointment_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (practice_id, patient_id, prediction_kind, appointment_id)
         WHERE appointment_id IS NOT NULL
       DO UPDATE
         SET score = EXCLUDED.score,
             factors = EXCLUDED.factors,
             model_version = EXCLUDED.model_version,
             computed_at = NOW()
       RETURNING id`,
      params,
    )
    return res.rows[0].id
  }

  const res = await pool.query(
    `INSERT INTO ehr_patient_predictions
       (practice_id, patient_id, prediction_kind, score, factors,
        model_version, appointment_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, NULL)
     ON CONFLICT (practice_id, patient_id, prediction_kind)
       WHERE appointment_id IS NULL
     DO UPDATE
       SET score = EXCLUDED.score,
           factors = EXCLUDED.factors,
           model_version = EXCLUDED.model_version,
           computed_at = NOW()
     RETURNING id`,
    params,
  )
  return res.rows[0].id
}
