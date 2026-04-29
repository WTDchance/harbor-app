// app/api/ehr/saved-views/route.ts
//
// W49 D5 — list + create saved views (for /dashboard/patients sidebar).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SCOPES = new Set(['personal', 'practice'])

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT id, user_id, name, scope, filter, sort, columns, created_at, updated_at
       FROM practice_saved_views
      WHERE practice_id = $1
        AND (scope = 'practice' OR user_id = $2)
      ORDER BY scope DESC, name ASC`,
    [ctx.practiceId, ctx.user.id],
  )

  await auditEhrAccess({
    ctx, action: 'saved_view.list',
    resourceType: 'practice_saved_view', details: { count: rows.length },
  })

  return NextResponse.json({ saved_views: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const name = String(body.name ?? '').trim().slice(0, 80)
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  const scope = SCOPES.has(body.scope) ? body.scope : 'personal'

  const ins = await pool.query(
    `INSERT INTO practice_saved_views
       (practice_id, user_id, name, scope, filter, sort, columns)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
     RETURNING id, user_id, name, scope, filter, sort, columns, created_at, updated_at`,
    [
      ctx.practiceId, ctx.user.id, name, scope,
      JSON.stringify(body.filter ?? {}),
      JSON.stringify(body.sort ?? {}),
      JSON.stringify(Array.isArray(body.columns) ? body.columns : []),
    ],
  )

  await auditEhrAccess({
    ctx, action: 'saved_view.create',
    resourceType: 'practice_saved_view', resourceId: ins.rows[0].id,
    details: { name, scope },
  })

  return NextResponse.json({ saved_view: ins.rows[0] }, { status: 201 })
}
