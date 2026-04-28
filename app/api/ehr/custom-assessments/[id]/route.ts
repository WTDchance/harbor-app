// app/api/ehr/custom-assessments/[id]/route.ts

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { validateTemplate } from '@/lib/aws/ehr/assessments/score'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT id, name, description, questions, scoring_function,
            severity_bands, is_active, created_at, updated_at
       FROM ehr_custom_assessment_templates
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [params.id, ctx.practiceId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ template: rows[0] })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const fields: string[] = []
  const args: any[] = []

  if (body.name !== undefined) { args.push(String(body.name)); fields.push(`name = $${args.length}`) }
  if (body.description !== undefined) {
    args.push(body.description ? String(body.description).slice(0, 2000) : null)
    fields.push(`description = $${args.length}`)
  }

  // questions / scoring / bands change together — re-validate.
  if (body.questions !== undefined || body.scoring_function !== undefined || body.severity_bands !== undefined) {
    // Pull current to fill in any omitted field.
    const cur = await pool.query(
      `SELECT questions, scoring_function, severity_bands
         FROM ehr_custom_assessment_templates
        WHERE id = $1 AND practice_id = $2 LIMIT 1`,
      [params.id, ctx.practiceId],
    )
    if (cur.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const validated = validateTemplate({
      questions: body.questions ?? cur.rows[0].questions,
      scoring_function: body.scoring_function ?? cur.rows[0].scoring_function,
      severity_bands: body.severity_bands ?? cur.rows[0].severity_bands,
    })
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })

    args.push(JSON.stringify(validated.questions)); fields.push(`questions = $${args.length}::jsonb`)
    args.push(validated.scoring_function); fields.push(`scoring_function = $${args.length}`)
    args.push(JSON.stringify(validated.severity_bands)); fields.push(`severity_bands = $${args.length}::jsonb`)
  }

  let disablingNow = false
  if (body.is_active === false) {
    args.push(false); fields.push(`is_active = $${args.length}`)
    disablingNow = true
  }
  if (body.is_active === true) {
    args.push(true); fields.push(`is_active = $${args.length}`)
  }

  if (fields.length === 0) return NextResponse.json({ error: 'no_fields' }, { status: 400 })

  args.push(params.id, ctx.practiceId)
  const { rows } = await pool.query(
    `UPDATE ehr_custom_assessment_templates SET ${fields.join(', ')}
      WHERE id = $${args.length - 1} AND practice_id = $${args.length}
      RETURNING id, name, description, questions, scoring_function,
                severity_bands, is_active, created_at, updated_at`,
    args,
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: disablingNow ? 'custom_assessment.template_disabled' : 'custom_assessment.template_updated',
    resourceType: 'ehr_custom_assessment_template',
    resourceId: params.id,
    details: { fields_changed: fields.length },
  })
  return NextResponse.json({ template: rows[0] })
}
