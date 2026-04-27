// app/api/ehr/practice/locations/[id]/route.ts
//
// Wave 42 / T2 — update + soft-delete one practice location.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODALITY = new Set(['in_person','telehealth','both'])
const UPDATABLE = ['name','address_line1','address_line2','city','state','zip','phone'] as const

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
      args.push(body[k] == null ? null : String(body[k]))
      sets.push(`${k} = $${args.length}`)
    }
  }
  if (typeof body.modality_preference === 'string' && MODALITY.has(body.modality_preference)) {
    args.push(body.modality_preference); sets.push(`modality_preference = $${args.length}`)
  }
  if (typeof body.is_primary === 'boolean' && body.is_primary === true) {
    // Clear any existing primary first.
    await pool.query(
      `UPDATE ehr_practice_locations SET is_primary = FALSE
        WHERE practice_id = $1 AND is_primary = TRUE AND id <> $2`,
      [ctx.practiceId, id],
    )
    args.push(true); sets.push(`is_primary = $${args.length}`)
  }
  if (sets.length === 0) return NextResponse.json({ error: 'no fields to update' }, { status: 400 })

  args.push(ctx.practiceId, id)
  const { rows } = await pool.query(
    `UPDATE ehr_practice_locations SET ${sets.join(', ')}
      WHERE practice_id = $${args.length - 1} AND id = $${args.length}
      RETURNING *`,
    args,
  )
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'practice_settings.updated',
    resourceType: 'ehr_practice_location',
    resourceId: id,
    details: { kind: 'location_updated', fields_changed: sets.map((s) => s.split(' ')[0]) },
  })

  return NextResponse.json({ location: rows[0] })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const { rows } = await pool.query(
    `UPDATE ehr_practice_locations SET is_active = FALSE, is_primary = FALSE
      WHERE practice_id = $1 AND id = $2 RETURNING id`,
    [ctx.practiceId, id],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'practice_settings.updated',
    resourceType: 'ehr_practice_location',
    resourceId: id,
    details: { kind: 'location_deactivated' },
  })
  return NextResponse.json({ deactivated: true })
}
