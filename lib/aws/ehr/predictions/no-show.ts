// lib/aws/ehr/predictions/no-show.ts
//
// W45 T2 stub — real heuristic lands in T3 (feat/no-show-prediction-v1).
// This stub returns a 0 score with a 'stub' formula_version so any
// rows written before T3 merges are easy to identify and recompute.

import type { PredictionFactors } from './types'

export const NO_SHOW_MODEL_VERSION = 'no_show.stub'

export async function computeNoShow(
  _practiceId: string,
  _patientId: string,
  _appointmentId: string,
): Promise<{ score: number; factors: PredictionFactors }> {
  return {
    score: 0,
    factors: {
      contributions: [],
      formula_version: 'no_show.stub',
      summary: 'Heuristic stub — real formula lands in T3.',
    },
  }
}
