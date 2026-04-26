// app/api/ehr/therapists/route.ts
//
// Wave 22 (AWS port). List + update credentialing fields on the
// therapists table.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

const UPDATABLE = new Set([
  'license_number', 'license_state', 'license_type', 'license_expires_at',
  'npi', 'ceu_hours_ytd', 'ceu_required_yearly', 'ceu_cycle_ends_at',
  'insurance_panels',
])

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  try {
    const { rows } = await pool.query(
      `SELECT id, display_name, credentials, is_primary,
              license_number, license_state, license_type, license_expires_at,
              npi, ceu_hours_ytd, ceu_required_yearly, ceu_cycle_ends_at,
              insurance_panels
         FROM therapists
        WHERE practice_id = $1
        ORDER BY display_name ASC NULLS LAST`,
      [ctx.practiceId],
    )
    return NextResponse.json({ therapists: rows })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body?.therapist_id) return NextResponse.json({ error: 'therapist_id required' }, { status: 400 })

  const sets: string[] = []
  const args: any[] = [body.therapist_id, ctx.practiceId]
  for (const [k, v] of Object.entries(body)) {
    if (!UPDATABLE.has(k)) continue
    args.push(v)
    sets.push(`${k} = $${args.length}`)
  }
  if (sets.length === 0) return NextResponse.json({ error: 'No updatable fields' }, { status: 400 })

  try {
    const { rows } = await pool.query(
      `UPDATE therapists SET ${sets.join(', ')}
        WHERE id = $1 AND practice_id = $2
        RETURNING *`,
      args,
    )
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await auditEhrAccess({
      ctx,
      action: 'note.update',
      resourceType: 'therapist',
      resourceId: rows[0].id,
      details: { kind: 'credentialing', fields: Object.keys(body).filter((k) => UPDATABLE.has(k)) },
    })
    return NextResponse.json({ therapist: rows[0] })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
