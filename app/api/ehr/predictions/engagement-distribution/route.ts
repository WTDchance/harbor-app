// app/api/ehr/predictions/engagement-distribution/route.ts
//
// W47 T0 — buckets the practice's current engagement scores into
// 0-25 / 25-50 / 50-75 / 75-100 % bands for the Today engagement
// trends widget.

import { NextResponse } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE score < 0.25)::int                     AS b0,
       COUNT(*) FILTER (WHERE score >= 0.25 AND score < 0.50)::int   AS b1,
       COUNT(*) FILTER (WHERE score >= 0.50 AND score < 0.75)::int   AS b2,
       COUNT(*) FILTER (WHERE score >= 0.75)::int                    AS b3
     FROM ehr_patient_predictions
     WHERE practice_id = $1
       AND prediction_kind = 'engagement_score'
       AND appointment_id IS NULL`,
    [ctx.practiceId],
  )
  const r = rows[0] || { b0: 0, b1: 0, b2: 0, b3: 0 }

  return NextResponse.json({
    buckets: [
      { range: '0-25%',   count: r.b0 },
      { range: '25-50%',  count: r.b1 },
      { range: '50-75%',  count: r.b2 },
      { range: '75-100%', count: r.b3 },
    ],
  })
}
