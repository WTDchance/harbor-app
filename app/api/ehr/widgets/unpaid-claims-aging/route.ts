// W49 D6 — open claims aging buckets. Reads from ehr_claim_submissions.

import { NextResponse } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE submitted_at >= NOW() - INTERVAL '30 days')::int AS bucket_0_30,
       COUNT(*) FILTER (WHERE submitted_at < NOW() - INTERVAL '30 days'
                          AND submitted_at >= NOW() - INTERVAL '60 days')::int AS bucket_31_60,
       COUNT(*) FILTER (WHERE submitted_at < NOW() - INTERVAL '60 days')::int AS bucket_60_plus,
       COUNT(*)::int AS total
       FROM ehr_claim_submissions
      WHERE practice_id = $1
        AND status NOT IN ('paid','denied_final','void')`,
    [ctx.practiceId],
  ).catch(() => ({ rows: [{ bucket_0_30: 0, bucket_31_60: 0, bucket_60_plus: 0, total: 0 }] }))

  return NextResponse.json(result.rows[0])
}
