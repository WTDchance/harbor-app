// app/api/ehr/note-templates/[id]/route.ts

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const fields: string[] = []
  const args: any[] = []
  if (body.name !== undefined) { args.push(String(body.name)); fields.push(`name = $${args.length}`) }
  if (body.description !== undefined) {
    args.push(body.description ? String(body.description) : null)
    fields.push(`description = $${args.length}`)
  }
  if (Array.isArray(body.sections)) {
    args.push(JSON.stringify(body.sections))
    fields.push(`sections = $${args.length}::jsonb`)
  }
  if (body.archived === true) { args.push(new Date().toISOString()); fields.push(`archived_at = $${args.length}`) }
  if (body.archived === false) { args.push(null); fields.push(`archived_at = $${args.length}`) }

  if (fields.length === 0) return NextResponse.json({ error: 'no_fields' }, { status: 400 })

  args.push(params.id, ctx.practiceId)
  const { rows } = await pool.query(
    `UPDATE ehr_note_templates SET ${fields.join(', ')}
      WHERE id = $${args.length - 1} AND practice_id = $${args.length}
      RETURNING id, name, description, sections, archived_at, created_at, updated_at`,
    args,
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'note_template.updated',
    resourceType: 'ehr_note_template',
    resourceId: params.id,
    details: { fields_changed: fields.length },
  })
  return NextResponse.json({ template: rows[0] })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rowCount } = await pool.query(
    `DELETE FROM ehr_note_templates WHERE id = $1 AND practice_id = $2`,
    [params.id, ctx.practiceId],
  )
  if (rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'note_template.deleted',
    resourceType: 'ehr_note_template',
    resourceId: params.id,
    details: {},
  })
  return NextResponse.json({ ok: true })
}
