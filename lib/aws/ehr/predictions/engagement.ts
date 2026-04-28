// lib/aws/ehr/predictions/engagement.ts
//
// W45 T2 stub — real heuristic lands in T5 (feat/engagement-score).

import type { PredictionFactors } from './types'

export const ENGAGEMENT_MODEL_VERSION = 'engagement.stub'

export async function computeEngagement(
  _practiceId: string,
  _patientId: string,
): Promise<{ score: number; factors: PredictionFactors }> {
  return {
    score: 0.5,
    factors: {
      contributions: [],
      formula_version: 'engagement.stub',
      summary: 'Heuristic stub — real formula lands in T5.',
    },
  }
}
