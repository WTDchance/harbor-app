// app/api/ehr/saved-views/[id]/route.ts
//
// W47 T5 — read / update / delete a single saved view. Modify only
// the owner can do (RLS gate).

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
    `SELECT id, owner_user_id::text, name, filters, sort,
            is_shared_with_practice, created_at, updated_at,
            (owner_user_id = $1) AS is_mine
       FROM ehr_saved_patient_views
      WHERE id = $2 AND practice_id = $3
        AND (owner_user_id = $1 OR is_shared_with_practice = TRUE)
      LIMIT 1`,
    [ctx.userId, params.id, ctx.practiceId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'saved_view.used',
    resourceType: 'ehr_saved_patient_view',
    resourceId: params.id,
    details: { is_mine: rows[0].is_mine },
  })
  return NextResponse.json({ view: rows[0] })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const fields: string[] = []
  const args: any[] = []
  if (body.name !== undefined) {
    const n = String(body.name).trim()
    if (!n || n.length > 100) return NextResponse.json({ error: 'name_invalid' }, { status: 400 })
    args.push(n); fields.push(`name = $${args.length}`)
  }
  if (body.filters !== undefined && body.filters && typeof body.filters === 'object') {
    args.push(JSON.stringify(body.filters))
    fields.push(`filters = $${args.length}::jsonb`)
  }
  if (body.sort !== undefined && body.sort && typeof body.sort === 'object') {
    args.push(JSON.stringify(body.sort))
    fields.push(`sort = $${args.length}::jsonb`)
  }
  if (body.is_shared_with_practice !== undefined) {
    args.push(!!body.is_shared_with_practice)
    fields.push(`is_shared_with_practice = $${args.length}`)
  }
  if (fields.length === 0) return NextResponse.json({ error: 'no_fields' }, { status: 400 })

  args.push(params.id, ctx.userId)
  const { rows } = await pool.query(
    `UPDATE ehr_saved_patient_views SET ${fields.join(', ')}
      WHERE id = $${args.length - 1} AND owner_user_id = $${args.length}
      RETURNING id, name, filters, sort, is_shared_with_practice, created_at, updated_at`,
    args,
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found_or_forbidden' }, { status: 404 })

  await auditEhrAccess({
    ctx, action: 'saved_view.updated',
    resourceType: 'ehr_saved_patient_view', resourceId: params.id,
    details: { fields_changed: fields.length },
  })
  return NextResponse.json({ view: rows[0] })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rowCount } = await pool.query(
    `DELETE FROM ehr_saved_patient_views
      WHERE id = $1 AND owner_user_id = $2`,
    [params.id, ctx.userId],
  )
  if (rowCount === 0) return NextResponse.json({ error: 'not_found_or_forbidden' }, { status: 404 })

  await auditEhrAccess({
    ctx, action: 'saved_view.deleted',
    resourceType: 'ehr_saved_patient_view', resourceId: params.id,
    details: {},
  })
  return NextResponse.json({ ok: true })
}
