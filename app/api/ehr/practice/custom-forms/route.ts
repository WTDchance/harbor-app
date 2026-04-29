// app/api/ehr/practice/custom-forms/route.ts
//
// W49 D1 — list and create practice custom forms.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { validateSchema, slugify, FORM_NAME_MAX, FORM_DESC_MAX } from '@/lib/ehr/custom-forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const sp = req.nextUrl.searchParams
  const status = sp.get('status') // optional: 'draft' | 'published' | 'archived'

  const args: any[] = [ctx.practiceId]
  let cond = 'practice_id = $1 AND deleted_at IS NULL'
  if (status && ['draft', 'published', 'archived'].includes(status)) {
    args.push(status)
    cond += ` AND status = $${args.length}`
  }

  const { rows } = await pool.query(
    `SELECT id, name, slug, description, status, schema, created_at, updated_at
       FROM practice_custom_forms
      WHERE ${cond}
      ORDER BY created_at DESC
      LIMIT 200`,
    args,
  )

  await auditEhrAccess({
    ctx,
    action: 'custom_form.list',
    resourceType: 'practice_custom_form',
    details: { count: rows.length, status_filter: status ?? null },
  })

  return NextResponse.json({ forms: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const name = String(body.name ?? '').trim().slice(0, FORM_NAME_MAX)
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  const description = body.description ? String(body.description).trim().slice(0, FORM_DESC_MAX) : null

  const v = validateSchema(body.schema ?? [])
  if (!v.ok) return NextResponse.json({ error: 'invalid_schema', message: v.error }, { status: 400 })

  // Generate practice-unique slug.
  const baseSlug = slugify(name)
  let slug = baseSlug
  for (let i = 2; i < 50; i++) {
    const r = await pool.query(
      `SELECT 1 FROM practice_custom_forms WHERE practice_id = $1 AND slug = $2 LIMIT 1`,
      [ctx.practiceId, slug],
    )
    if (r.rows.length === 0) break
    slug = `${baseSlug}-${i}`
  }

  const ins = await pool.query(
    `INSERT INTO practice_custom_forms
       (practice_id, name, slug, description, schema, status, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'draft', $6)
     RETURNING id, name, slug, description, status, schema, created_at, updated_at`,
    [ctx.practiceId, name, slug, description, JSON.stringify(v.schema), ctx.user.id],
  )

  await auditEhrAccess({
    ctx,
    action: 'custom_form.created',
    resourceType: 'practice_custom_form',
    resourceId: ins.rows[0].id,
    details: { name, slug, field_count: v.schema.length },
  })

  return NextResponse.json({ form: ins.rows[0] }, { status: 201 })
}
