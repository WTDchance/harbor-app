// app/api/ehr/patients/[id]/outcome-trend/route.ts
//
// W52 D3 — sparkline + summary view over assessment_administrations
// (the new W52 catalog). Distinct from the W41 /outcomes endpoint
// which returns the legacy ehr_assessment_admin shape with norm bands.
//
// Used by <PatientOutcomeTrend> on patient detail.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const { rows } = await pool.query(
    `SELECT a.assessment_slug, a.raw_score, a.computed_score, a.completed_at,
            d.name AS assessment_name, d.scope
       FROM assessment_administrations a
       JOIN assessment_definitions d ON d.slug = a.assessment_slug
      WHERE a.practice_id = $1 AND a.patient_id = $2 AND a.status = 'completed'
        AND a.assessment_slug IN ('phq-9','gad-7','pcl-5','audit-c')
      ORDER BY a.completed_at ASC`,
    [ctx.practiceId, patientId],
  ).catch(() => ({ rows: [] as any[] }))

  const series: Record<string, { date: string; score: number; severity: string | null }[]> = {}
  for (const r of rows) {
    if (r.raw_score == null || !r.completed_at) continue
    const key = r.assessment_slug
    series[key] = series[key] ?? []
    series[key].push({
      date: r.completed_at,
      score: Number(r.raw_score),
      severity: r.computed_score?.severity_label ?? null,
    })
  }

  const summary: Record<string, { baseline: number; current: number; delta: number; n: number }> = {}
  for (const [slug, list] of Object.entries(series)) {
    if (list.length === 0) continue
    summary[slug] = { baseline: list[0].score, current: list[list.length - 1].score, delta: list[list.length - 1].score - list[0].score, n: list.length }
  }

  await auditEhrAccess({
    ctx, action: 'outcomes.patient_viewed' as any,
    resourceType: 'assessment_administration',
    details: { patient_id: patientId, series_count: Object.keys(series).length },
  })

  return NextResponse.json({ series, summary })
}
