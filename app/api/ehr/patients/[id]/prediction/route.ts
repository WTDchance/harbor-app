// app/api/ehr/patients/[id]/prediction/route.ts
//
// W50 D3 — return the latest v2 prediction for a patient.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const { rows } = await pool.query(
    `SELECT id, no_show_prob, dropout_prob, payment_risk_score, churn_score,
            composite_severity, factors, model_version, computed_at
       FROM ehr_patient_predictions_v2
      WHERE practice_id = $1 AND patient_id = $2
      ORDER BY computed_at DESC
      LIMIT 1`,
    [ctx.practiceId, patientId],
  ).catch(() => ({ rows: [] as any[] }))

  return NextResponse.json({ prediction: rows[0] ?? null })
}
