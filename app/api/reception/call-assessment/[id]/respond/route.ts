// W52 D2 — Retell tool: record one or more responses for an in-call
// assessment. When all questions are answered, scores + persists.
import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'
import { scoreAssessment, type AssessmentResponse } from '@/lib/ehr/assessments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null) as { responses?: AssessmentResponse[]; finalize?: boolean } | null
  if (!body?.responses || !Array.isArray(body.responses)) {
    return NextResponse.json({ error: 'responses_required' }, { status: 400 })
  }

  const r = await pool.query(
    `SELECT a.id, a.practice_id, a.assessment_slug, a.status, a.responses,
            d.questions, d.scoring_rules
       FROM assessment_administrations a
       JOIN assessment_definitions d ON d.slug = a.assessment_slug
      WHERE a.id = $1 LIMIT 1`,
    [id],
  )
  if (r.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const row = r.rows[0]

  // Merge new responses on top of any existing ones (last-write-wins per q id).
  const existing: AssessmentResponse[] = Array.isArray(row.responses) ? row.responses : []
  const merged: AssessmentResponse[] = []
  const seen = new Set<string>()
  for (const r of [...body.responses, ...existing]) {
    if (seen.has(r.question_id)) continue
    seen.add(r.question_id)
    merged.push(r)
  }

  const allAnswered = (row.questions as any[]).every((q: any) => merged.some(m => m.question_id === q.id))
  const finalize = body.finalize === true || allAnswered

  if (!finalize) {
    await pool.query(
      `UPDATE assessment_administrations SET responses = $1::jsonb WHERE id = $2`,
      [JSON.stringify(merged), id],
    )
    return NextResponse.json({ ok: true, partial: true })
  }

  const scored = scoreAssessment({ questions: row.questions, scoring_rules: row.scoring_rules }, merged)
  await pool.query(
    `UPDATE assessment_administrations
        SET status = 'completed', responses = $1::jsonb, raw_score = $2,
            computed_score = $3::jsonb, crisis_flagged = $4, completed_at = NOW()
      WHERE id = $5`,
    [
      JSON.stringify(merged), scored.raw_score,
      JSON.stringify({ severity_label: scored.severity_label, crisis_reasons: scored.crisis_reasons }),
      scored.crisis_flagged, id,
    ],
  )

  await writeAuditLog({
    practice_id: row.practice_id,
    action: 'assessment.completed',
    resource_type: 'assessment_administration',
    resource_id: id,
    severity: scored.crisis_flagged ? 'critical' : 'info',
    details: { slug: row.assessment_slug, raw_score: scored.raw_score, severity_label: scored.severity_label, crisis_flagged: scored.crisis_flagged, via: 'in_call' },
  })

  return NextResponse.json({
    ok: true,
    raw_score: scored.raw_score,
    severity_label: scored.severity_label,
    crisis_flagged: scored.crisis_flagged,
    escalate_to: scored.escalate_to,
  })
}
