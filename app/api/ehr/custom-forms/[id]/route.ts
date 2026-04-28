// app/api/ehr/custom-forms/[id]/route.ts

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { validateFormQuestions } from '@/lib/aws/ehr/forms/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT id, name, description, kind, questions, is_active, created_at, updated_at
       FROM ehr_custom_forms
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [params.id, ctx.practiceId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx, action: 'custom_form.viewed',
    resourceType: 'ehr_custom_form', resourceId: params.id,
    details: {},
  })
  return NextResponse.json({ form: rows[0] })
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
  if (body.kind !== undefined && ['intake','reflection','satisfaction','roi_request','custom'].includes(body.kind)) {
    args.push(body.kind); fields.push(`kind = $${args.length}`)
  }
  if (Array.isArray(body.questions)) {
    const validated = validateFormQuestions(body.questions)
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })
    args.push(JSON.stringify(validated.questions)); fields.push(`questions = $${args.length}::jsonb`)
  }
  if (body.is_active !== undefined) {
    args.push(!!body.is_active); fields.push(`is_active = $${args.length}`)
  }
  if (fields.length === 0) return NextResponse.json({ error: 'no_fields' }, { status: 400 })

  args.push(params.id, ctx.practiceId)
  const { rows } = await pool.query(
    `UPDATE ehr_custom_forms SET ${fields.join(', ')}
      WHERE id = $${args.length - 1} AND practice_id = $${args.length}
      RETURNING id, name, description, kind, questions, is_active, created_at, updated_at`,
    args,
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx, action: 'custom_form.template_updated',
    resourceType: 'ehr_custom_form', resourceId: params.id,
    details: { fields_changed: fields.length },
  })
  return NextResponse.json({ form: rows[0] })
}
