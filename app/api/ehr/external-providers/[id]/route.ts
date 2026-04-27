// app/api/ehr/external-providers/[id]/route.ts
//
// Wave 40 / P3 — fetch / update / soft-delete one external provider.
// DELETE is a soft delete (sets deleted_at) so historical references
// from discharge_summaries.referral_provider_ids and
// patient_external_providers don't dangle.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UPDATABLE = [
  'name','npi','role','organization','phone','fax','email','address','notes',
] as const
const ROLES = new Set(['pcp','psychiatrist','school','attorney','other'])

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const { rows } = await pool.query(
    `SELECT * FROM ehr_external_providers
      WHERE practice_id = $1 AND id = $2 LIMIT 1`,
    [ctx.practiceId, id],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'external_provider.view',
    resourceType: 'ehr_external_provider',
    resourceId: id,
  })

  return NextResponse.json({ provider: rows[0] })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const sets: string[] = []
  const args: unknown[] = []
  for (const k of UPDATABLE) {
    if (k in body) {
      const v = body[k]
      if (k === 'role' && typeof v === 'string' && !ROLES.has(v)) {
        return NextResponse.json(
          { error: { code: 'invalid_request', message: `role must be one of ${[...ROLES].join('|')}` } },
          { status: 400 },
        )
      }
      args.push(v == null ? null : String(v))
      sets.push(`${k} = $${args.length}`)
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: 'no fields to update' }, { status: 400 })

  args.push(ctx.practiceId, id)
  const { rows } = await pool.query(
    `UPDATE ehr_external_providers
        SET ${sets.join(', ')}
      WHERE practice_id = $${args.length - 1}
        AND id          = $${args.length}
        AND deleted_at IS NULL
      RETURNING *`,
    args,
  )
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'external_provider.update',
    resourceType: 'ehr_external_provider',
    resourceId: id,
    details: { fields_changed: sets.map((s) => s.split(' ')[0]) },
  })

  return NextResponse.json({ provider: rows[0] })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const { rows } = await pool.query(
    `UPDATE ehr_external_providers
        SET deleted_at = NOW()
      WHERE practice_id = $1 AND id = $2 AND deleted_at IS NULL
      RETURNING id`,
    [ctx.practiceId, id],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'external_provider.delete',
    resourceType: 'ehr_external_provider',
    resourceId: id,
    details: { soft_delete: true },
  })

  return NextResponse.json({ deleted: true })
}
