// app/api/ehr/custom-forms/route.ts
//
// W47 T2 — list + create custom forms per practice.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { validateFormQuestions, FORM_KINDS, type FormKind } from '@/lib/aws/ehr/forms/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const includeInactive = req.nextUrl.searchParams.get('include_inactive') === 'true'
  const kind = req.nextUrl.searchParams.get('kind')

  const conds: string[] = ['practice_id = $1']
  const args: any[] = [ctx.practiceId]
  if (!includeInactive) conds.push(`is_active = TRUE`)
  if (kind && (FORM_KINDS as readonly string[]).includes(kind)) {
    args.push(kind)
    conds.push(`kind = $${args.length}`)
  }

  const { rows } = await pool.query(
    `SELECT id, name, description, kind, questions, is_active, created_at, updated_at
       FROM ehr_custom_forms
      WHERE ${conds.join(' AND ')}
      ORDER BY is_active DESC, name ASC`,
    args,
  )
  return NextResponse.json({ forms: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const kind: FormKind = (FORM_KINDS as readonly string[]).includes(body.kind) ? body.kind : 'custom'

  const validated = validateFormQuestions(body.questions)
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })

  const ins = await pool.query(
    `INSERT INTO ehr_custom_forms
       (practice_id, name, description, kind, questions, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id, name, description, kind, questions, is_active, created_at, updated_at`,
    [
      ctx.practiceId, name,
      body.description ? String(body.description).slice(0, 2000) : null,
      kind, JSON.stringify(validated.questions),
      ctx.userId,
    ],
  )

  await auditEhrAccess({
    ctx,
    action: 'custom_form.template_created',
    resourceType: 'ehr_custom_form',
    resourceId: ins.rows[0].id,
    details: { kind, question_count: validated.questions.length },
  })
  return NextResponse.json({ form: ins.rows[0] }, { status: 201 })
}
