// app/api/ehr/insurance-authorizations/[id]/route.ts
//
// Wave 40 / P1 — fetch and update one authorization.
// No DELETE — auths are historical records; supersede via status='superseded'.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UPDATABLE = [
  'payer', 'auth_number', 'sessions_authorized', 'sessions_used',
  'valid_from', 'valid_to', 'cpt_codes_covered', 'notes', 'status',
] as const
const VALID_STATUSES = new Set(['active', 'expired', 'exhausted', 'superseded'])

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const { rows } = await pool.query(
    `SELECT *, valid_from::text AS valid_from, valid_to::text AS valid_to
       FROM ehr_insurance_authorizations
      WHERE practice_id = $1 AND id = $2 LIMIT 1`,
    [ctx.practiceId, id],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'insurance_authorization.view',
    resourceType: 'ehr_insurance_authorization',
    resourceId: id,
    details: { patient_id: rows[0].patient_id },
  })

  return NextResponse.json({ authorization: rows[0] })
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
      if (k === 'status' && typeof v === 'string' && !VALID_STATUSES.has(v)) {
        return NextResponse.json(
          { error: { code: 'invalid_request', message: `status must be one of ${[...VALID_STATUSES].join(', ')}` } },
          { status: 400 },
        )
      }
      if (k === 'cpt_codes_covered') {
        args.push(Array.isArray(v) ? v.map((x) => String(x)) : [])
      } else if (k === 'sessions_authorized' || k === 'sessions_used') {
        args.push(Number(v))
      } else {
        args.push(v == null ? null : String(v))
      }
      sets.push(`${k} = $${args.length}`)
    }
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }
  args.push(ctx.practiceId, id)
  const { rows } = await pool.query(
    `UPDATE ehr_insurance_authorizations
        SET ${sets.join(', ')}
      WHERE practice_id = $${args.length - 1} AND id = $${args.length}
      RETURNING *, valid_from::text AS valid_from, valid_to::text AS valid_to`,
    args,
  )
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'insurance_authorization.update',
    resourceType: 'ehr_insurance_authorization',
    resourceId: id,
    details: {
      patient_id: rows[0].patient_id,
      fields_changed: sets.map((s) => s.split(' ')[0]),
    },
  })

  return NextResponse.json({ authorization: rows[0] })
}
