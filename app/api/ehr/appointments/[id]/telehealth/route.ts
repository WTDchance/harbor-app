// app/api/ehr/appointments/[id]/telehealth/route.ts
//
// Wave 22 (AWS port). Generate (or return existing) a unique
// telehealth room slug for the appointment. v1 provider: Jitsi public
// (replace with BAA-backed Doxy / Daily / self-hosted Jitsi for prod).

import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

const PROVIDER_URL = 'https://meet.jit.si/'

function newSlug(): string {
  return 'harbor-' + randomBytes(9).toString('base64url')
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const { rows } = await pool.query(
    `SELECT id, telehealth_room_slug FROM appointments
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, ctx.practiceId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })

  let slug = rows[0].telehealth_room_slug
  let createdNew = false
  if (!slug) {
    slug = newSlug()
    await pool.query(
      `UPDATE appointments SET telehealth_room_slug = $1
        WHERE id = $2 AND practice_id = $3`,
      [slug, id, ctx.practiceId],
    )
    createdNew = true
  }

  await auditEhrAccess({
    ctx,
    action: 'note.view',
    resourceType: 'appointment',
    resourceId: id,
    details: { kind: 'telehealth_link', created_or_reused: createdNew ? 'created' : 'reused' },
  })

  return NextResponse.json({ slug, url: PROVIDER_URL + slug, provider: 'jitsi_public' })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  const { rows } = await pool.query(
    `SELECT telehealth_room_slug FROM appointments
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, ctx.practiceId],
  )
  if (!rows[0]?.telehealth_room_slug) return NextResponse.json({ slug: null, url: null })
  return NextResponse.json({
    slug: rows[0].telehealth_room_slug,
    url: PROVIDER_URL + rows[0].telehealth_room_slug,
    provider: 'jitsi_public',
  })
}
