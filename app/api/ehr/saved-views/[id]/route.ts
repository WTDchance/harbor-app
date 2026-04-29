// W49 D5 — update / delete a saved view.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SCOPES = new Set(['personal', 'practice'])

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const sets: string[] = []
  const args: any[] = []
  if (body.name !== undefined) { args.push(String(body.name).slice(0, 80)); sets.push(`name = $${args.length}`) }
  if (body.scope !== undefined) {
    if (!SCOPES.has(body.scope)) return NextResponse.json({ error: 'invalid_scope' }, { status: 400 })
    args.push(body.scope); sets.push(`scope = $${args.length}`)
  }
  for (const k of ['filter', 'sort', 'columns']) {
    if ((body as any)[k] !== undefined) {
      args.push(JSON.stringify((body as any)[k])); sets.push(`${k} = $${args.length}::jsonb`)
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: 'no_changes' }, { status: 400 })
  args.push(id, ctx.user.id, ctx.practiceId)

  const upd = await pool.query(
    `UPDATE practice_saved_views
        SET ${sets.join(', ')}
      WHERE id = $${args.length - 2} AND user_id = $${args.length - 1} AND practice_id = $${args.length}
      RETURNING id, user_id, name, scope, filter, sort, columns, created_at, updated_at`,
    args,
  )
  if (upd.rows.length === 0) return NextResponse.json({ error: 'not_found_or_not_owner' }, { status: 404 })

  await auditEhrAccess({
    ctx, action: 'saved_view.update',
    resourceType: 'practice_saved_view', resourceId: id,
  })
  return NextResponse.json({ saved_view: upd.rows[0] })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const del = await pool.query(
    `DELETE FROM practice_saved_views
      WHERE id = $1 AND user_id = $2 AND practice_id = $3 RETURNING id`,
    [id, ctx.user.id, ctx.practiceId],
  )
  if (del.rows.length === 0) return NextResponse.json({ error: 'not_found_or_not_owner' }, { status: 404 })

  await auditEhrAccess({
    ctx, action: 'saved_view.delete',
    resourceType: 'practice_saved_view', resourceId: id,
  })
  return NextResponse.json({ ok: true })
}
