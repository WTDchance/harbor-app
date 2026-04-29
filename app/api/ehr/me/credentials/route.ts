// app/api/ehr/me/credentials/route.ts
//
// W49 T4 — read + update the signed-in user's credentialing fields.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FIELDS = [
  'npi', 'license_type', 'license_number', 'license_state',
  'license_expires_at', 'caqh_id', 'dea_number',
] as const

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT npi, license_type, license_number, license_state,
            license_expires_at::text, caqh_id, dea_number
       FROM users WHERE id = $1 LIMIT 1`,
    [ctx.userId],
  )
  return NextResponse.json({ credentials: rows[0] || null })
}

export async function PATCH(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const fields: string[] = []
  const args: any[] = []
  for (const f of FIELDS) {
    if (body[f] === undefined) continue
    let v = body[f]
    if (v !== null) v = String(v).slice(0, 64)
    if (f === 'license_expires_at' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return NextResponse.json({ error: 'license_expires_at must be YYYY-MM-DD' }, { status: 400 })
    }
    args.push(v); fields.push(`${f} = $${args.length}`)
  }
  if (fields.length === 0) return NextResponse.json({ error: 'no_fields' }, { status: 400 })

  args.push(ctx.userId)
  await pool.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${args.length}`,
    args,
  )

  await auditEhrAccess({
    ctx,
    action: 'credentialing.updated',
    resourceType: 'user',
    resourceId: ctx.userId,
    details: { fields_changed: fields.length },
  })
  return NextResponse.json({ ok: true })
}
