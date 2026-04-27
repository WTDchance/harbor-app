// app/api/ehr/appointments/[id]/telehealth/route.ts
//
// Wave 38 TS2 — generate (or return existing) a Chime SDK meeting for the
// appointment. Falls back to the legacy public Jitsi room when Chime
// isn't configured (CHIME_ENABLED env flag) so existing dev flows don't
// break overnight.
//
// HIPAA: Chime SDK Meetings is BAA-covered. We persist only the Chime
// MeetingId on the appointment row -- no PHI. The provider field flips
// to 'chime' when this row uses Chime. Existing telehealth_room_slug
// rows continue working under provider='jitsi_public'.

import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { createChimeMeeting, getChimeMeeting } from '@/lib/aws/chime'

const PROVIDER_URL_LEGACY = 'https://meet.jit.si/'

function chimeEnabled(): boolean {
  return process.env.CHIME_ENABLED === '1' || process.env.CHIME_ENABLED === 'true'
}

function newSlug(): string {
  return 'harbor-' + randomBytes(9).toString('base64url')
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const { rows } = await pool.query(
    `SELECT id, telehealth_room_slug, video_meeting_id, video_provider
       FROM appointments
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, ctx.practiceId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })

  const row = rows[0]

  // Chime path
  if (chimeEnabled()) {
    let meetingId: string | null = row.video_meeting_id
    let createdNew = false

    // Probe Chime; if missing, recreate.
    if (meetingId) {
      const existing = await getChimeMeeting(meetingId)
      if (!existing) meetingId = null
    }

    if (!meetingId) {
      const meeting = await createChimeMeeting({ externalMeetingId: id })
      meetingId = meeting?.MeetingId || null
      if (!meetingId) {
        return NextResponse.json({ error: 'chime_create_failed' }, { status: 502 })
      }
      await pool.query(
        `UPDATE appointments
            SET video_meeting_id = $1, video_provider = 'chime'
          WHERE id = $2 AND practice_id = $3`,
        [meetingId, id, ctx.practiceId],
      )
      createdNew = true
    }

    await auditEhrAccess({
      ctx,
      action: 'note.view',
      resourceType: 'appointment',
      resourceId: id,
      details: { kind: 'telehealth_chime', created_or_reused: createdNew ? 'created' : 'reused' },
    })

    return NextResponse.json({
      provider: 'chime',
      meeting_id: meetingId,
      url: `/meet/${id}`,
    })
  }

  // Legacy Jitsi fallback (existing slug-based behavior).
  let slug = row.telehealth_room_slug
  let createdNew = false
  if (!slug) {
    slug = newSlug()
    await pool.query(
      `UPDATE appointments
          SET telehealth_room_slug = $1,
              video_provider = 'jitsi_public'
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
    details: { kind: 'telehealth_jitsi', created_or_reused: createdNew ? 'created' : 'reused' },
  })
  return NextResponse.json({
    provider: 'jitsi_public',
    slug,
    url: PROVIDER_URL_LEGACY + slug,
  })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  const { rows } = await pool.query(
    `SELECT telehealth_room_slug, video_meeting_id, video_provider
       FROM appointments
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, ctx.practiceId],
  )
  const row = rows[0]
  if (!row) return NextResponse.json({ provider: null, url: null })
  if (row.video_provider === 'chime' && row.video_meeting_id) {
    return NextResponse.json({ provider: 'chime', meeting_id: row.video_meeting_id, url: `/meet/${id}` })
  }
  if (row.telehealth_room_slug) {
    return NextResponse.json({
      provider: row.video_provider || 'jitsi_public',
      slug: row.telehealth_room_slug,
      url: PROVIDER_URL_LEGACY + row.telehealth_room_slug,
    })
  }
  return NextResponse.json({ provider: null, url: null })
}
