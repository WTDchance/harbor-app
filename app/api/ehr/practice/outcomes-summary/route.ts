// W52 D3 — aggregate outcome metrics across the practice's patients.
import { NextResponse } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  // For each patient + slug, compute first vs latest score.
  const r = await pool.query(
    `WITH ranked AS (
       SELECT patient_id, assessment_slug, raw_score, completed_at,
              ROW_NUMBER() OVER (PARTITION BY patient_id, assessment_slug ORDER BY completed_at ASC) AS rn_first,
              ROW_NUMBER() OVER (PARTITION BY patient_id, assessment_slug ORDER BY completed_at DESC) AS rn_last
         FROM assessment_administrations
        WHERE practice_id = $1
          AND status = 'completed'
          AND raw_score IS NOT NULL
          AND assessment_slug IN ('phq-9','gad-7')
     ),
     pairs AS (
       SELECT
         f.patient_id, f.assessment_slug,
         f.raw_score AS baseline,
         l.raw_score AS current,
         f.completed_at AS first_at, l.completed_at AS last_at
         FROM ranked f JOIN ranked l USING (patient_id, assessment_slug)
        WHERE f.rn_first = 1 AND l.rn_last = 1 AND f.completed_at < l.completed_at
     )
     SELECT
       assessment_slug,
       COUNT(*)::int AS n,
       AVG(baseline - current)::numeric(10,2) AS avg_reduction,
       (COUNT(*) FILTER (WHERE current * 2 <= baseline))::int AS responders,
       (COUNT(*) FILTER (WHERE last_at >= NOW() - INTERVAL '12 weeks' AND current * 2 <= baseline))::int AS sustained_12w
       FROM pairs
       GROUP BY assessment_slug`,
    [ctx.practiceId],
  ).catch(() => ({ rows: [] as any[] }))

  // Crisis frequency over the trailing 90 days.
  const crisis = await pool.query(
    `SELECT COUNT(*)::int AS n FROM assessment_administrations
      WHERE practice_id = $1 AND crisis_flagged = TRUE AND completed_at >= NOW() - INTERVAL '90 days'`,
    [ctx.practiceId],
  ).catch(() => ({ rows: [{ n: 0 }] }))

  // Engagement: completed / assigned ratio across last 90 days.
  const engagement = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*)::int AS total
       FROM assessment_administrations
      WHERE practice_id = $1 AND created_at >= NOW() - INTERVAL '90 days'`,
    [ctx.practiceId],
  ).catch(() => ({ rows: [{ completed: 0, total: 0 }] }))

  await auditEhrAccess({ ctx, action: 'outcomes.summary_viewed' as any, resourceType: 'practice' })

  return NextResponse.json({
    by_assessment: r.rows,
    crisis_flags_90d: crisis.rows[0]?.n ?? 0,
    engagement: {
      completed: engagement.rows[0]?.completed ?? 0,
      total: engagement.rows[0]?.total ?? 0,
      ratio: engagement.rows[0]?.total > 0
        ? Math.round((engagement.rows[0].completed / engagement.rows[0].total) * 1000) / 10
        : 0,
    },
  })
}
