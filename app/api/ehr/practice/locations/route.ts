// app/api/ehr/practice/locations/route.ts
//
// Wave 42 / T2 — list + create practice locations.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODALITY = new Set(['in_person','telehealth','both'])

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT * FROM ehr_practice_locations
      WHERE practice_id = $1 AND is_active = TRUE
      ORDER BY is_primary DESC, name ASC`,
    [ctx.practiceId],
  )
  return NextResponse.json({ locations: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const name = String(body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: { code: 'invalid_request', message: 'name required' } }, { status: 400 })
  const modality = typeof body.modality_preference === 'string' && MODALITY.has(body.modality_preference)
    ? body.modality_preference : 'both'

  // If is_primary requested, clear any existing primary first (unique partial index).
  const isPrimary = body.is_primary === true
  if (isPrimary) {
    await pool.query(
      `UPDATE ehr_practice_locations SET is_primary = FALSE WHERE practice_id = $1 AND is_primary = TRUE`,
      [ctx.practiceId],
    )
  }

  const { rows } = await pool.query(
    `INSERT INTO ehr_practice_locations
       (practice_id, name, address_line1, address_line2, city, state, zip, phone,
        modality_preference, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      ctx.practiceId, name,
      body.address_line1 ?? null, body.address_line2 ?? null,
      body.city ?? null, body.state ?? null, body.zip ?? null, body.phone ?? null,
      modality, isPrimary,
    ],
  )

  await auditEhrAccess({
    ctx,
    action: 'practice_settings.updated',
    resourceType: 'ehr_practice_location',
    resourceId: rows[0].id,
    details: { kind: 'location_created', name, modality, is_primary: isPrimary },
  })

  return NextResponse.json({ location: rows[0] }, { status: 201 })
}
