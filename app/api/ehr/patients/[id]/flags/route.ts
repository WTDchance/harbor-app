// app/api/ehr/patients/[id]/flags/route.ts
//
// W47 T4 — patient flags. Up to 5 ACTIVE flags per patient (enforced
// at the API layer; hard CHECK can't reference a count subquery).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_ACTIVE = 5
const COLORS = new Set(['blue', 'green', 'yellow', 'red'])

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const includeArchived = req.nextUrl.searchParams.get('include_archived') === 'true'

  const { rows } = await pool.query(
    `SELECT id, content, color, created_at, updated_at, archived_at,
            created_by_user_id::text
       FROM ehr_patient_flags
      WHERE practice_id = $1 AND patient_id = $2
        ${includeArchived ? '' : 'AND archived_at IS NULL'}
      ORDER BY archived_at NULLS FIRST, created_at DESC`,
    [ctx.practiceId, params.id],
  )

  return NextResponse.json({ flags: rows })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const content = String(body.content || '').trim()
  if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 })
  if (content.length > 200) return NextResponse.json({ error: 'content too long' }, { status: 400 })

  const color = COLORS.has(body.color) ? body.color : 'blue'

  // Verify patient is in this practice + count active flags atomically.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const pCheck = await client.query(
      `SELECT id FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
      [params.id, ctx.practiceId],
    )
    if (pCheck.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
    }
    const countRes = await client.query(
      `SELECT COUNT(*)::int AS n FROM ehr_patient_flags
        WHERE practice_id = $1 AND patient_id = $2 AND archived_at IS NULL`,
      [ctx.practiceId, params.id],
    )
    if (countRes.rows[0].n >= MAX_ACTIVE) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'flag_limit_reached', max: MAX_ACTIVE }, { status: 409 })
    }
    const ins = await client.query(
      `INSERT INTO ehr_patient_flags
         (practice_id, patient_id, content, color, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, content, color, created_at, updated_at, archived_at`,
      [ctx.practiceId, params.id, content, color, ctx.userId],
    )
    await client.query('COMMIT')

    await auditEhrAccess({
      ctx,
      action: 'patient_flag.added',
      resourceType: 'ehr_patient_flag',
      resourceId: ins.rows[0].id,
      details: { color, content_chars: content.length },
    })

    return NextResponse.json({ flag: ins.rows[0] }, { status: 201 })
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  } finally {
    client.release()
  }
}
