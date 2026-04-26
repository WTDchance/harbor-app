// Read-only ICS calendar feed — token-authed (MINIMIZED PHI).
//
// Token-keyed via practices.ics_feed_token. Note: the unified ics-token /
// ics-qr / token routes ported in Wave 3 use practices.calendar_token
// (different column) and point at /api/calendar/feed. THIS route remains
// for stale subscribers who pasted the legacy /api/calendar/ics/<token>
// URL into their calendar app — those subscriptions keep working.
//
// PRIVACY POSTURE preserved verbatim: SUMMARY='Harbor appointment',
// LOCATION=practice name, DESCRIPTION=opaque ref + dashboard link. No
// patient names. Therapists wanting full detail use the Google Workspace
// BAA path or the dashboard.
//
// AWS canonical schema notes:
//   appointments.scheduled_for replaces scheduled_at. Legacy
//   appointment_date + appointment_time fallback preserved for clusters
//   where those columns still exist.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface AppointmentRow {
  id: string
  scheduled_for: string | null
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

function icsEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

function icsFold(line: string): string {
  const out: string[] = []
  let remaining = line
  if (remaining.length <= 75) return remaining
  out.push(remaining.slice(0, 75))
  remaining = remaining.slice(75)
  while (remaining.length > 74) {
    out.push(' ' + remaining.slice(0, 74))
    remaining = remaining.slice(74)
  }
  if (remaining.length > 0) out.push(' ' + remaining)
  return out.join('\r\n')
}

function icsDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
    'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z'
  )
}

function apptStart(row: AppointmentRow): Date | null {
  // Prefer AWS canonical scheduled_for; fall back to legacy scheduled_at;
  // last resort is the legacy date+time pair.
  const ts = row.scheduled_for || row.scheduled_at
  if (ts) {
    const d = new Date(ts)
    if (!isNaN(d.getTime())) return d
  }
  if (row.appointment_date && row.appointment_time) {
    const t = row.appointment_time.length === 5 ? row.appointment_time + ':00' : row.appointment_time
    const d = new Date(`${row.appointment_date}T${t}`)
    if (!isNaN(d.getTime())) return d
  }
  return null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!token || typeof token !== 'string' || token.length < 16) {
    return new NextResponse('Invalid token', { status: 404 })
  }

  // Look up by ics_feed_token. Fall back gracefully if the column doesn't
  // exist on this cluster (shouldn't happen, but defensive).
  let practice: { id: string; name: string | null; ics_feed_revoked_at: string | null } | null = null
  try {
    const r = await pool.query(
      `SELECT id, name, ics_feed_revoked_at
         FROM practices
        WHERE ics_feed_token = $1
        LIMIT 1`,
      [token],
    )
    practice = r.rows[0] ?? null
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }
  if (!practice) return new NextResponse('Not found', { status: 404 })

  if (practice.ics_feed_revoked_at) {
    return new NextResponse(
      'Calendar feed has been revoked. Generate a new URL in Harbor settings.',
      { status: 410 },
    )
  }

  const now = new Date()
  const windowStart = new Date(now.getTime() - 60 * 86_400_000)
  const windowEnd = new Date(now.getTime() + 180 * 86_400_000)

  const apptRes = await pool.query(
    `SELECT id, scheduled_for,
            duration_minutes, appointment_type, status,
            patient_id, updated_at, created_at
       FROM appointments
      WHERE practice_id = $1
        AND scheduled_for >= $2 AND scheduled_for <= $3
      ORDER BY scheduled_for ASC
      LIMIT 500`,
    [practice.id, windowStart.toISOString(), windowEnd.toISOString()],
  ).catch(() => ({ rows: [] as any[] }))

  const rows: AppointmentRow[] = apptRes.rows.map((r: any) => ({
    id: r.id,
    scheduled_for: r.scheduled_for,
    scheduled_at: null,
    appointment_date: null,
    appointment_time: null,
    duration_minutes: r.duration_minutes,
    appointment_type: r.appointment_type,
    status: r.status,
    patient_id: r.patient_id,
    updated_at: r.updated_at,
    created_at: r.created_at,
  }))

  const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://lab.harboroffice.ai').replace(/\/$/, '')
  const lines: string[] = []
  lines.push('BEGIN:VCALENDAR')
  lines.push('VERSION:2.0')
  lines.push('PRODID:-//Harbor//Calendar Feed 1.0//EN')
  lines.push('CALSCALE:GREGORIAN')
  lines.push('METHOD:PUBLISH')
  lines.push(`X-WR-CALNAME:Harbor — ${icsEscape(practice.name || 'Appointments')}`)
  lines.push('X-WR-CALDESC:Minimized-PHI appointment feed from Harbor. Full details in the Harbor dashboard.')
  lines.push('X-PUBLISHED-TTL:PT15M')
  lines.push('REFRESH-INTERVAL;VALUE=DURATION:PT15M')

  for (const row of rows) {
    if (!row.id) continue
    const start = apptStart(row)
    if (!start) continue
    const durationMin = row.duration_minutes ?? 50
    const end = new Date(start.getTime() + durationMin * 60_000)
    const status = (row.status || 'scheduled').toLowerCase()
    if (status === 'cancelled' || status === 'cancelled_late' || status === 'no_show') continue

    const summary = 'Harbor appointment'
    const apptType = row.appointment_type ? ` (${row.appointment_type.replace(/_/g, ' ')})` : ''
    const refId = row.id.split('-')[0] || row.id.slice(0, 8)
    const desc = [
      `Harbor reference: ${refId}${apptType}`,
      '',
      'Full details in the Harbor dashboard:',
      `${appUrl}/dashboard/appointments/${row.id}`,
    ].join('\n')

    const uid = `${row.id}@harborreceptionist.com`
    const dtstamp = icsDateTime(row.updated_at ? new Date(row.updated_at) : now)

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${uid}`)
    lines.push(`DTSTAMP:${dtstamp}`)
    lines.push(`DTSTART:${icsDateTime(start)}`)
    lines.push(`DTEND:${icsDateTime(end)}`)
    lines.push(icsFold(`SUMMARY:${icsEscape(summary)}`))
    lines.push(icsFold(`DESCRIPTION:${icsEscape(desc)}`))
    if (practice.name) lines.push(icsFold(`LOCATION:${icsEscape(practice.name)}`))
    lines.push(`STATUS:${status === 'confirmed' ? 'CONFIRMED' : 'TENTATIVE'}`)
    lines.push('TRANSP:OPAQUE')
    lines.push(`URL:${appUrl}/dashboard/appointments/${row.id}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  const body = lines.join('\r\n') + '\r\n'

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="harbor-${practice.id.slice(0, 8)}.ics"`,
      'Cache-Control': 'private, max-age=60',
    },
  })
}
