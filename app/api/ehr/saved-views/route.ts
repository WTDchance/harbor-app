// app/api/ehr/saved-views/route.ts
//
// W47 T5 — list + create saved patient-list views.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  // RLS already filters: own views OR is_shared_with_practice=true
  // within the user's practice.
  const { rows } = await pool.query(
    `SELECT id, owner_user_id::text, name, filters, sort,
            is_shared_with_practice, created_at, updated_at,
            (owner_user_id = $1) AS is_mine
       FROM ehr_saved_patient_views
      WHERE practice_id = $2
        AND (owner_user_id = $1 OR is_shared_with_practice = TRUE)
      ORDER BY is_mine DESC, name ASC`,
    [ctx.userId, ctx.practiceId],
  )
  return NextResponse.json({ views: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const name = String(body.name || '').trim()
  if (!name || name.length > 100) {
    return NextResponse.json({ error: 'name_invalid' }, { status: 400 })
  }
  const filters = (body.filters && typeof body.filters === 'object') ? body.filters : {}
  const sort = (body.sort && typeof body.sort === 'object') ? body.sort : {}
  const shared = !!body.is_shared_with_practice

  const ins = await pool.query(
    `INSERT INTO ehr_saved_patient_views
       (practice_id, owner_user_id, name, filters, sort, is_shared_with_practice)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
     ON CONFLICT (owner_user_id, name) DO UPDATE
       SET filters = EXCLUDED.filters,
           sort = EXCLUDED.sort,
           is_shared_with_practice = EXCLUDED.is_shared_with_practice
     RETURNING id, name, filters, sort, is_shared_with_practice, created_at, updated_at`,
    [ctx.practiceId, ctx.userId, name, JSON.stringify(filters), JSON.stringify(sort), shared],
  )

  await auditEhrAccess({
    ctx,
    action: 'saved_view.created',
    resourceType: 'ehr_saved_patient_view',
    resourceId: ins.rows[0].id,
    details: {
      filter_keys: Object.keys(filters),
      shared,
    },
  })
  return NextResponse.json({ view: ins.rows[0] }, { status: 201 })
}
