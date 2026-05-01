// app/api/reception/calendar/create-event/route.ts
//
// W51 D3 — create a calendar event on the practice's connected calendar.

import { NextResponse, type NextRequest } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'
import { decryptToken } from '@/lib/aws/token-encryption'
import { createEvent as outlookCreateEvent, refreshAccessToken as refreshOutlook } from '@/lib/outlookCalendar'
import { createEvent as googleCreateEvent, refreshAccessToken as refreshGoogle } from '@/lib/aws/googleCalendar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  therapist_id?: string | null
  subject: string
  body_html?: string
  start_iso: string
  end_iso: string
  timezone?: string
  attendees?: string[]
  location?: string
}

export async function POST(req: NextRequest) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 400 })

  const body = await req.json().catch(() => null) as Body | null
  if (!body || !body.subject || !body.start_iso || !body.end_iso) {
    return NextResponse.json({ error: 'missing_required_fields' }, { status: 400 })
  }

  const args: any[] = [ctx.practiceId]
  let cond = "practice_id = $1 AND status = 'active'"
  if (body.therapist_id) { args.push(body.therapist_id); cond += ` AND therapist_id = $${args.length}` }
  const { rows } = await pool.query(
    `SELECT id, provider, refresh_token_encrypted, access_token_encrypted, access_token_expires_at
       FROM practice_calendar_integrations
      WHERE ${cond}
      ORDER BY updated_at DESC LIMIT 1`,
    args,
  )
  if (rows.length === 0) return NextResponse.json({ error: 'no_calendar_connected' }, { status: 400 })
  const row = rows[0]

  if (row.provider !== 'outlook' && row.provider !== 'google') {
    return NextResponse.json({ error: 'unsupported_provider', provider: row.provider }, { status: 400 })
  }

  let access = await decryptToken(row.access_token_encrypted)
  if (!access || !row.access_token_expires_at || new Date(row.access_token_expires_at) < new Date()) {
    try {
      const refresh = await decryptToken(row.refresh_token_encrypted)
      const fresh = row.provider === 'google'
        ? await refreshGoogle(refresh)
        : await refreshOutlook(refresh)
      access = fresh.access_token
    } catch {
      return NextResponse.json({ error: 'token_refresh_failed' }, { status: 502 })
    }
  }

  const event = row.provider === 'google'
    ? await googleCreateEvent(access, {
        subject: body.subject,
        bodyHtml: body.body_html,
        startISO: body.start_iso,
        endISO: body.end_iso,
        timezone: body.timezone,
        attendees: body.attendees,
        location: body.location,
      })
    : await outlookCreateEvent(access, {
        subject: body.subject,
        bodyHtml: body.body_html,
        startISO: body.start_iso,
        endISO: body.end_iso,
        timezone: body.timezone,
        attendees: body.attendees,
        location: body.location,
      })
  if (!event) return NextResponse.json({ error: 'event_create_failed' }, { status: 502 })

  await writeAuditLog({
    practice_id: ctx.practiceId, user_id: ctx.user.id,
    action: 'calendar.event_created', resource_type: 'practice_calendar_integration',
    resource_id: row.id, severity: 'info',
    details: { provider: row.provider, event_id: event.id },
  })

  return NextResponse.json({ event })
}
