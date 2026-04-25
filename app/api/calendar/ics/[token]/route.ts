/**
 * GET /api/calendar/ics/[token]
 *
 * Read-only ICS calendar feed. Therapists paste this URL into Apple Calendar,
 * Google Calendar, Outlook, or any RFC 5545 compliant calendar app as a
 * SUBSCRIBED calendar.
 *
 * PRIVACY POSTURE
 * ---------------
 * Subscribed calendars flow through the therapist's calendar provider
 * (Apple, Google, Microsoft). Most therapists' calendar providers are NOT
 * BAA-covered. Therefore the feed intentionally carries MINIMIZED PHI:
 *
 *   - Event title (SUMMARY): "Harbor appointment" (no patient name)
 *   - Location: practice name (not clinically sensitive)
 *   - Description: opaque Harbor patient-reference + link to dashboard
 *
 * A therapist who wants full patient names + session notes in their native
 * calendar must either:
 *   (a) Be on Google Workspace with a signed BAA, and use the direct
 *       Google Calendar integration (which writes full detail), or
 *   (b) Use the Harbor dashboard directly.
 *
 * AUTH
 * ----
 * Token-based. Practices get one opaque token in `practices.ics_feed_token`.
 * Anyone with the token can subscribe — treat it like a password.
 * Regenerate via settings to revoke existing subscribers.
 *
 * OUTPUT
 * ------
 * Returns `text/calendar; charset=utf-8`. Includes appointments with
 * status NOT IN ('cancelled', 'no_show') within the next 180 days and the
 * previous 60 days (so the calendar shows recent history too).
 */

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
// Public endpoint (token-authed). No session/cookie checks.
export const runtime = 'nodejs'

interface AppointmentRow {
  id: string
  scheduled_at: string | null
  appointment_date: string | null
  appointment_time: string | null
  duration_minutes: number | null
  appointment_type: string | null
  status: string | null
  patient_id: string | null
  updated_at: string | null
  created_at: string | null
}

// ---------------------------------------------------------------------------
// ICS formatting helpers
// ---------------------------------------------------------------------------

/** RFC 5545: escape commas, semicolons, and backslashes in text fields. */
function icsEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** RFC 5545: fold lines at 75 octets with CRLF + single space continuation. */
function icsFold(line: string): string {
  const out: string[] = []
  let remaining = line
  const FIRST_LINE_LIMIT = 75
  const CONT_LIMIT = 74 // leading space consumes one octet
  if (remaining.length <= FIRST_LINE_LIMIT) return remaining
  out.push(remaining.slice(0, FIRST_LINE_LIMIT))
  remaining = remaining.slice(FIRST_LINE_LIMIT)
  while (remaining.length > CONT_LIMIT) {
    out.push(' ' + remaining.slice(0, CONT_LIMIT))
    remaining = remaining.slice(CONT_LIMIT)
  }
  if (remaining.length > 0) out.push(' ' + remaining)
  return out.join('\r\n')
}

/** RFC 5545 DATE-TIME format: YYYYMMDDTHHMMSSZ (UTC). */
function icsDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  )
}

/**
 * Derive a start Date from an appointment row. Prefers `scheduled_at` (timestamptz)
 * then falls back to composing appointment_date + appointment_time. Returns null
 * if neither parses cleanly.
 */
function apptStart(row: AppointmentRow): Date | null {
  if (row.scheduled_at) {
    const d = new Date(row.scheduled_at)
    if (!isNaN(d.getTime())) return d
  }
  if (row.appointment_date && row.appointment_time) {
    // appointment_time might be "14:30" or "14:30:00"
    const iso = `${row.appointment_date}T${row.appointment_time.length === 5 ? row.appointment_time + ':00' : row.appointment_time}`
    const d = new Date(iso)
    if (!isNaN(d.getTime())) return d
  }
  return null
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  const token = params.token
  if (!token || typeof token !== 'string' || token.length < 16) {
    return new Response('Invalid token', { status: 404 })
  }

  // Look up the practice by token
  const { data: practice, error: practiceError } = await supabaseAdmin
    .from('practices')
    .select('id, name, ics_feed_token, ics_feed_revoked_at, phone_number')
    .eq('ics_feed_token', token)
    .maybeSingle()

  if (practiceError || !practice) {
    return new Response('Not found', { status: 404 })
  }
  if (practice.ics_feed_revoked_at) {
    return new Response('Calendar feed has been revoked. Generate a new URL in Harbor settings.', {
      status: 410,
    })
  }

  const now = new Date()
  const windowStart = new Date(now.getTime() - 60 * 86400_000) // 60 days back
  const windowEnd = new Date(now.getTime() + 180 * 86400_000) // 180 days ahead

  const { data: appointments, error: apptError } = await supabaseAdmin
    .from('appointments')
    .select(
      'id, scheduled_at, appointment_date, appointment_time, duration_minutes, appointment_type, status, patient_id, updated_at, created_at'
    )
    .eq('practice_id', practice.id)
    .gte('scheduled_at', windowStart.toISOString())
    .lte('scheduled_at', windowEnd.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(500)

  if (apptError) {
    console.error('[ics] appointments query failed', apptError)
    return new Response('Feed generation failed', { status: 500 })
  }

  const rows: AppointmentRow[] = (appointments as AppointmentRow[]) ?? []

  // Build ICS
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
  const lines: string[] = []
  lines.push('BEGIN:VCALENDAR')
  lines.push('VERSION:2.0')
  lines.push('PRODID:-//Harbor//Calendar Feed 1.0//EN')
  lines.push('CALSCALE:GREGORIAN')
  lines.push('METHOD:PUBLISH')
  lines.push(`X-WR-CALNAME:Harbor — ${icsEscape(practice.name || 'Appointments')}`)
  lines.push(`X-WR-CALDESC:Minimized-PHI appointment feed from Harbor. Full details in the Harbor dashboard.`)
  // iOS / macOS refresh hint: every 15 minutes
  lines.push('X-PUBLISHED-TTL:PT15M')
  lines.push('REFRESH-INTERVAL;VALUE=DURATION:PT15M')

  for (const row of rows) {
    if (!row.id) continue
    const start = apptStart(row)
    if (!start) continue

    const durationMin = row.duration_minutes ?? 50
    const end = new Date(start.getTime() + durationMin * 60_000)
    const status = (row.status || 'scheduled').toLowerCase()
    // Skip cancels/no-shows from the feed — keeps the therapist's view tidy.
    if (status === 'cancelled' || status === 'cancelled_late' || status === 'no_show') continue

    // MINIMIZED PHI — no patient name, no clinical reason
    const summary = 'Harbor appointment'
    const apptType = row.appointment_type
      ? ` (${row.appointment_type.replace(/_/g, ' ')})`
      : ''
    const refId = row.id.split('-')[0] || row.id.slice(0, 8)
    const descLines = [
      `Harbor reference: ${refId}${apptType}`,
      '',
      `Full details in the Harbor dashboard:`,
      `${appUrl}/dashboard/appointments/${row.id}`,
    ]

    const uid = `${row.id}@harborreceptionist.com`
    const dtstamp = icsDateTime(row.updated_at ? new Date(row.updated_at) : now)

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${uid}`)
    lines.push(`DTSTAMP:${dtstamp}`)
    lines.push(`DTSTART:${icsDateTime(start)}`)
    lines.push(`DTEND:${icsDateTime(end)}`)
    lines.push(icsFold(`SUMMARY:${icsEscape(summary)}`))
    lines.push(icsFold(`DESCRIPTION:${icsEscape(descLines.join('\n'))}`))
    if (practice.name) lines.push(icsFold(`LOCATION:${icsEscape(practice.name)}`))
    lines.push(`STATUS:${status === 'confirmed' ? 'CONFIRMED' : 'TENTATIVE'}`)
    lines.push('TRANSP:OPAQUE')
    lines.push(`URL:${appUrl}/dashboard/appointments/${row.id}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  const body = lines.join('\r\n') + '\r\n'

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="harbor-${practice.id.slice(0, 8)}.ics"`,
      // Clients poll; short cache OK.
      'Cache-Control': 'private, max-age=60',
    },
  })
}
