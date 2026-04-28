// app/api/ehr/custom-assessments/[id]/administer/route.ts
//
// W46 T4 — therapist or patient-portal calls this with answers. We
// score with the locked DSL, then persist into outcome_assessments
// with instrument='custom:<template_id>' so timeline + dashboards
// pick it up without a schema change.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { scoreAssessment, type ScoringFunction, type Question, type SeverityBand } from '@/lib/aws/ehr/assessments/score'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body?.patient_id || !body?.answers) {
    return NextResponse.json({ error: 'patient_id and answers required' }, { status: 400 })
  }
  const patientId = String(body.patient_id)
  const answers = body.answers as Record<string, unknown>

  const tpl = await pool.query(
    `SELECT id, name, questions, scoring_function, severity_bands, is_active
       FROM ehr_custom_assessment_templates
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [params.id, ctx.practiceId],
  )
  if (tpl.rows.length === 0) return NextResponse.json({ error: 'template_not_found' }, { status: 404 })
  if (!tpl.rows[0].is_active) return NextResponse.json({ error: 'template_disabled' }, { status: 400 })

  const result = scoreAssessment({
    scoring_function: tpl.rows[0].scoring_function as ScoringFunction,
    questions: tpl.rows[0].questions as Question[],
    answers,
    severity_bands: tpl.rows[0].severity_bands as SeverityBand[],
  })

  // Persist into outcome_assessments. instrument naming convention:
  // 'custom:<template_id>' so existing readers can detect and surface
  // the template name from the templates table on read.
  const ins = await pool.query(
    `INSERT INTO outcome_assessments
       (practice_id, patient_id, instrument, total_score, completed_at, raw_responses)
     VALUES ($1, $2, $3, $4, NOW(), $5::jsonb)
     RETURNING id`,
    [
      ctx.practiceId, patientId,
      `custom:${params.id}`,
      Math.round(result.total),
      JSON.stringify({ answers, per_subscale: result.per_subscale, band: result.band, alert: result.alert }),
    ],
  ).catch((err) => ({ rows: [], error: err }))

  await auditEhrAccess({
    ctx,
    action: 'custom_assessment.administered',
    resourceType: 'outcome_assessment',
    resourceId: (ins as any).rows?.[0]?.id || params.id,
    details: {
      template_id: params.id,
      total: result.total,
      band_label: result.band?.label || null,
      alert: result.alert,
    },
  })

  return NextResponse.json({
    score: result,
    persisted_outcome_assessment_id: (ins as any).rows?.[0]?.id || null,
  })
}
