// app/api/ehr/custom-assessments/route.ts
//
// W46 T4 — list + create custom assessment templates per practice.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { validateTemplate } from '@/lib/aws/ehr/assessments/score'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const includeInactive = req.nextUrl.searchParams.get('include_inactive') === 'true'

  const { rows } = await pool.query(
    `SELECT id, name, description, questions, scoring_function,
            severity_bands, is_active, created_at, updated_at
       FROM ehr_custom_assessment_templates
      WHERE practice_id = $1 ${includeInactive ? '' : 'AND is_active = TRUE'}
      ORDER BY is_active DESC, name ASC`,
    [ctx.practiceId],
  )
  return NextResponse.json({ templates: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const validated = validateTemplate({
    questions: body.questions,
    scoring_function: body.scoring_function,
    severity_bands: body.severity_bands,
  })
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })

  const ins = await pool.query(
    `INSERT INTO ehr_custom_assessment_templates
       (practice_id, name, description, questions, scoring_function,
        severity_bands, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7)
     RETURNING id, name, description, questions, scoring_function,
               severity_bands, is_active, created_at, updated_at`,
    [
      ctx.practiceId, name,
      body.description ? String(body.description).slice(0, 2000) : null,
      JSON.stringify(validated.questions),
      validated.scoring_function,
      JSON.stringify(validated.severity_bands),
      ctx.user.id,
    ],
  )

  await auditEhrAccess({
    ctx,
    action: 'custom_assessment.template_created',
    resourceType: 'ehr_custom_assessment_template',
    resourceId: ins.rows[0].id,
    details: {
      question_count: validated.questions.length,
      scoring_function: validated.scoring_function,
      band_count: validated.severity_bands.length,
    },
  })

  return NextResponse.json({ template: ins.rows[0] }, { status: 201 })
}
