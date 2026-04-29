// app/api/ehr/practice/custom-forms/[id]/route.ts
//
// W49 D1 — get / update / soft-delete a single custom form.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { validateSchema, FORM_NAME_MAX, FORM_DESC_MAX } from '@/lib/ehr/custom-forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = new Set(['draft', 'published', 'archived'])

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const { rows } = await pool.query(
    `SELECT id, name, slug, description, status, schema, created_at, updated_at
       FROM practice_custom_forms
      WHERE id = $1 AND practice_id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    [id, ctx.practiceId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'custom_form.viewed',
    resourceType: 'practice_custom_form',
    resourceId: id,
  })

  return NextResponse.json({ form: rows[0] })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const sets: string[] = []
  const args: any[] = []
  const audit: Record<string, unknown> = {}

  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, FORM_NAME_MAX)
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
    args.push(name); sets.push(`name = $${args.length}`); audit.name = name
  }
  if (typeof body.description === 'string' || body.description === null) {
    const d = body.description == null ? null : String(body.description).trim().slice(0, FORM_DESC_MAX)
    args.push(d); sets.push(`description = $${args.length}`)
  }
  if (body.schema !== undefined) {
    const v = validateSchema(body.schema)
    if (!v.ok) return NextResponse.json({ error: 'invalid_schema', message: v.error }, { status: 400 })
    args.push(JSON.stringify(v.schema)); sets.push(`schema = $${args.length}::jsonb`)
    audit.field_count = v.schema.length
  }

  let nextStatus: string | undefined
  if (typeof body.status === 'string') {
    if (!STATUSES.has(body.status)) return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
    nextStatus = body.status
    args.push(nextStatus); sets.push(`status = $${args.length}`); audit.status = nextStatus
  }

  if (sets.length === 0) return NextResponse.json({ error: 'no_changes' }, { status: 400 })

  args.push(id, ctx.practiceId)
  const upd = await pool.query(
    `UPDATE practice_custom_forms
        SET ${sets.join(', ')}
      WHERE id = $${args.length - 1} AND practice_id = $${args.length} AND deleted_at IS NULL
      RETURNING id, name, slug, description, status, schema, created_at, updated_at`,
    args,
  )
  if (upd.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: nextStatus === 'published' ? 'custom_form.published' :
            nextStatus === 'archived'  ? 'custom_form.archived' :
                                          'custom_form.updated',
    resourceType: 'practice_custom_form',
    resourceId: id,
    details: audit,
  })

  return NextResponse.json({ form: upd.rows[0] })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const upd = await pool.query(
    `UPDATE practice_custom_forms
        SET deleted_at = NOW(), status = 'archived'
      WHERE id = $1 AND practice_id = $2 AND deleted_at IS NULL
      RETURNING id`,
    [id, ctx.practiceId],
  )
  if (upd.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'custom_form.deleted',
    resourceType: 'practice_custom_form',
    resourceId: id,
  })

  return NextResponse.json({ ok: true })
}
