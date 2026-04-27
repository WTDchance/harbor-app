// app/api/ehr/external-providers/route.ts
//
// Wave 40 / P3 — practice-scoped external-provider directory.
// GET list (with ?role= filter), POST create.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROLES = ['pcp','psychiatrist','school','attorney','other'] as const

const TEXT_FIELDS = [
  'name','npi','organization','phone','fax','email','address','notes',
] as const

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const role = req.nextUrl.searchParams.get('role')
  const conds = ['practice_id = $1', 'deleted_at IS NULL']
  const args: unknown[] = [ctx.practiceId]
  if (role && (ROLES as readonly string[]).includes(role)) {
    args.push(role); conds.push(`role = $${args.length}`)
  }

  const { rows } = await pool.query(
    `SELECT * FROM ehr_external_providers
      WHERE ${conds.join(' AND ')}
      ORDER BY name ASC LIMIT 500`,
    args,
  )

  await auditEhrAccess({
    ctx,
    action: 'external_provider.list',
    resourceType: 'ehr_external_provider_list',
    resourceId: null,
    details: { count: rows.length, role_filter: role ?? null },
  })

  return NextResponse.json({ providers: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const role = typeof body.role === 'string' ? body.role : ''
  if (!name || !(ROLES as readonly string[]).includes(role)) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: `name and role (${ROLES.join('|')}) are required`,
        },
      },
      { status: 400 },
    )
  }

  const cols = ['practice_id', 'name', 'role']
  const vals: unknown[] = [ctx.practiceId, name, role]
  for (const f of TEXT_FIELDS) {
    if (f === 'name') continue
    if (f in body) {
      cols.push(f)
      vals.push(body[f] == null ? null : String(body[f]))
    }
  }
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ')

  const { rows } = await pool.query(
    `INSERT INTO ehr_external_providers (${cols.join(', ')})
     VALUES (${placeholders})
     RETURNING *`,
    vals,
  )

  await auditEhrAccess({
    ctx,
    action: 'external_provider.create',
    resourceType: 'ehr_external_provider',
    resourceId: rows[0].id,
    details: { role, has_npi: !!rows[0].npi },
  })

  return NextResponse.json({ provider: rows[0] }, { status: 201 })
}
