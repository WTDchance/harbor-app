// app/api/ehr/calendar-blocks/[id]/route.ts

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KINDS = new Set(['supervision','admin','lunch','vacation','training','other'])
const COLORS = new Set(['blue','green','yellow','red','gray','purple'])

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const fields: string[] = []
  const args: any[] = []

  if (body.title !== undefined) {
    const t = String(body.title).trim().slice(0, 200)
    if (!t) return NextResponse.json({ error: 'title invalid' }, { status: 400 })
    args.push(t); fields.push(`title = $${args.length}`)
  }
  if (body.kind !== undefined && KINDS.has(body.kind)) {
    args.push(body.kind); fields.push(`kind = $${args.length}`)
  }
  if (body.color !== undefined && COLORS.has(body.color)) {
    args.push(body.color); fields.push(`color = $${args.length}`)
  }
  if (body.starts_at !== undefined) {
    const d = new Date(body.starts_at)
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: 'starts_at invalid' }, { status: 400 })
    args.push(d.toISOString()); fields.push(`starts_at = $${args.length}::timestamptz`)
  }
  if (body.ends_at !== undefined) {
    const d = new Date(body.ends_at)
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: 'ends_at invalid' }, { status: 400 })
    args.push(d.toISOString()); fields.push(`ends_at = $${args.length}::timestamptz`)
  }
  if (body.is_recurring !== undefined) {
    args.push(!!body.is_recurring); fields.push(`is_recurring = $${args.length}`)
  }
  if (body.recurrence_rule !== undefined) {
    args.push(body.recurrence_rule ? String(body.recurrence_rule).slice(0, 500) : null)
    fields.push(`recurrence_rule = $${args.length}`)
  }
  if (body.notes !== undefined) {
    args.push(body.notes ? String(body.notes).slice(0, 1000) : null)
    fields.push(`notes = $${args.length}`)
  }
  if (fields.length === 0) return NextResponse.json({ error: 'no_fields' }, { status: 400 })

  args.push(params.id, ctx.userId)
  const { rows } = await pool.query(
    `UPDATE ehr_calendar_blocks SET ${fields.join(', ')}
      WHERE id = $${args.length - 1} AND user_id = $${args.length}
      RETURNING id`,
    args,
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found_or_forbidden' }, { status: 404 })

  await auditEhrAccess({
    ctx, action: 'calendar_block.updated',
    resourceType: 'ehr_calendar_block', resourceId: params.id,
    details: { fields_changed: fields.length },
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rowCount } = await pool.query(
    `DELETE FROM ehr_calendar_blocks WHERE id = $1 AND user_id = $2`,
    [params.id, ctx.userId],
  )
  if (rowCount === 0) return NextResponse.json({ error: 'not_found_or_forbidden' }, { status: 404 })

  await auditEhrAccess({
    ctx, action: 'calendar_block.deleted',
    resourceType: 'ehr_calendar_block', resourceId: params.id,
    details: {},
  })
  return NextResponse.json({ ok: true })
}
