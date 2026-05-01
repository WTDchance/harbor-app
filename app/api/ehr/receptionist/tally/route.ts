// W50 D5 — tally panel: success rate, fall-off, total, avg duration in window.

import { NextResponse, type NextRequest } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx

  const sp = req.nextUrl.searchParams
  const since = sp.get('since') || new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  const until = sp.get('until') || new Date().toISOString().slice(0, 10)

  const r = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE patient_id IS NOT NULL)::int AS captured_patient,
       COUNT(*) FILTER (WHERE inferred_crisis_risk = TRUE)::int AS crisis,
       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM appointments a WHERE a.call_log_id = call_logs.id))::int AS booked,
       AVG(duration_seconds)::int AS avg_duration_seconds
       FROM call_logs
      WHERE practice_id = $1
        AND created_at >= $2::date
        AND created_at < ($3::date + INTERVAL '1 day')`,
    [ctx.practiceId, since, until],
  ).catch(() => ({ rows: [{ total: 0, captured_patient: 0, crisis: 0, booked: 0, avg_duration_seconds: 0 }] }))

  return NextResponse.json({ ...r.rows[0], since, until })
}
