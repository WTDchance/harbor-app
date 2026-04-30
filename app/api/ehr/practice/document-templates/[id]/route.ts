// W52 D1 — update / archive a single template.
import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { ESIGN_CATEGORIES } from '@/lib/ehr/esign'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  const body = await req.json().catch(() => null) as Record<string, any> | null
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const sets: string[] = []
  const args: any[] = []
  if (body.name !== undefined) { args.push(String(body.name).slice(0, 200)); sets.push(`name = $${args.length}`) }
  if (body.category !== undefined) {
    if (!ESIGN_CATEGORIES.includes(body.category)) return NextResponse.json({ error: 'invalid_category' }, { status: 400 })
    args.push(body.category); sets.push(`category = $${args.length}`)
  }
  if (body.body_html !== undefined) { args.push(String(body.body_html)); sets.push(`body_html = $${args.length}`) }
  if (body.variables !== undefined) { args.push(JSON.stringify(body.variables)); sets.push(`variables = $${args.length}::jsonb`) }
  if (body.signature_fields !== undefined) { args.push(JSON.stringify(body.signature_fields)); sets.push(`signature_fields = $${args.length}::jsonb`) }
  if (body.status !== undefined) {
    if (!['active','archived'].includes(body.status)) return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
    args.push(body.status); sets.push(`status = $${args.length}`)
  }
  if (sets.length === 0) return NextResponse.json({ error: 'no_changes' }, { status: 400 })
  args.push(id, ctx.practiceId)
  const upd = await pool.query(
    `UPDATE practice_document_templates SET ${sets.join(', ')}
      WHERE id = $${args.length - 1} AND practice_id = $${args.length}
      RETURNING id, name, category, body_html, variables, signature_fields, status, created_at, updated_at`,
    args,
  )
  if (upd.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await auditEhrAccess({ ctx, action: 'document_template.updated' as any, resourceType: 'practice_document_template', resourceId: id })
  return NextResponse.json({ template: upd.rows[0] })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  const upd = await pool.query(
    `UPDATE practice_document_templates SET status = 'archived'
      WHERE id = $1 AND practice_id = $2 RETURNING id`,
    [id, ctx.practiceId],
  )
  if (upd.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await auditEhrAccess({ ctx, action: 'document_template.archived' as any, resourceType: 'practice_document_template', resourceId: id })
  return NextResponse.json({ ok: true })
}
