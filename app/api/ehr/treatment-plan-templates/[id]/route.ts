// app/api/ehr/treatment-plan-templates/[id]/route.ts

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT id, name, description, diagnoses, presenting_problem,
            goals, frequency, archived_at, created_at, updated_at
       FROM ehr_treatment_plan_templates
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [params.id, ctx.practiceId],
  )
  if (rows.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  return NextResponse.json({ template: rows[0] })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const fields: string[] = []
  const args: any[] = []

  function add(col: string, val: any, jsonb = false) {
    args.push(jsonb ? JSON.stringify(val) : val)
    fields.push(jsonb ? `${col} = $${args.length}::jsonb` : `${col} = $${args.length}`)
  }

  if (body.name !== undefined) add('name', String(body.name))
  if (body.description !== undefined) add('description', body.description ? String(body.description) : null)
  if (Array.isArray(body.diagnoses)) {
    add('diagnoses', body.diagnoses.map((d: any) => String(d)).filter(Boolean))
  }
  if (body.presenting_problem !== undefined) {
    add('presenting_problem', body.presenting_problem ? String(body.presenting_problem) : null)
  }
  if (Array.isArray(body.goals)) add('goals', body.goals, true)
  if (body.frequency !== undefined) {
    add('frequency', body.frequency ? String(body.frequency) : null)
  }
  if (body.archived === true) add('archived_at', new Date().toISOString())
  if (body.archived === false) add('archived_at', null)

  if (fields.length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }

  args.push(params.id, ctx.practiceId)
  const { rows } = await pool.query(
    `UPDATE ehr_treatment_plan_templates SET ${fields.join(', ')}
      WHERE id = $${args.length - 1} AND practice_id = $${args.length}
      RETURNING id, name, description, diagnoses, presenting_problem,
                goals, frequency, archived_at, created_at, updated_at`,
    args,
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'treatment_plan_template.edited',
    resourceType: 'ehr_treatment_plan_template',
    resourceId: params.id,
    details: { fields_changed: fields.length },
  })
  return NextResponse.json({ template: rows[0] })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rowCount } = await pool.query(
    `DELETE FROM ehr_treatment_plan_templates
      WHERE id = $1 AND practice_id = $2`,
    [params.id, ctx.practiceId],
  )
  if (rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'treatment_plan_template.deleted',
    resourceType: 'ehr_treatment_plan_template',
    resourceId: params.id,
    details: {},
  })
  return NextResponse.json({ ok: true })
}
