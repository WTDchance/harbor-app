// app/api/ehr/admin/checkins/practice-aggregate/route.ts
//
// W47 T0 — practice-wide daily check-in aggregate for the Today
// mood_heatmap widget. Avg mood per day across all patients.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const days = Math.max(7, Math.min(90, Number(req.nextUrl.searchParams.get('days') || '30')))

  const { rows } = await pool.query(
    `SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day,
            AVG(mood_score)::float AS avg_mood,
            COUNT(*)::int AS count
       FROM ehr_daily_checkins
      WHERE practice_id = $1
        AND created_at >= NOW() - ($2::int * INTERVAL '1 day')
      GROUP BY (created_at AT TIME ZONE 'UTC')::date
      ORDER BY (created_at AT TIME ZONE 'UTC')::date ASC`,
    [ctx.practiceId, days],
  )

  // Densify so the heatmap has every day in the range, even those
  // with no check-ins.
  const map = new Map<string, { avg_mood: number; count: number }>()
  for (const r of rows) map.set(r.day, { avg_mood: r.avg_mood, count: r.count })

  const out: Array<{ day: string; avg_mood: number; count: number }> = []
  const today = new Date(); today.setUTCHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() - i)
    const key = d.toISOString().slice(0, 10)
    const v = map.get(key)
    out.push({ day: key, avg_mood: v?.avg_mood ?? 0, count: v?.count ?? 0 })
  }

  return NextResponse.json({ days: out })
}
