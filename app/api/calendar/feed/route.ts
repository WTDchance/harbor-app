// Public ICS calendar feed authed by ?token= (a calendar_token on practices).
//
// Used to subscribe Apple Calendar / Google Calendar / etc. to a practice's
// appointment list. No Cognito session — token-only auth, like an API key,
// so the practice can hand the URL to a calendar app.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function formatDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

function escapeIcal(str: string): string {
  return (str || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
}

function foldLine(line: string): string {
  if (line.length <= 75) return line
  let result = ''
  while (line.length > 75) {
    result += line.slice(0, 75) + '\r\n '
    line = line.slice(75)
  }
  return result + line
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return new NextResponse('Missing token', { status: 400 })

  const practiceResult = await pool.query(
    `SELECT id, name FROM practices WHERE calendar_token = $1 LIMIT 1`,
    [token],
  ).catch(() => ({ rows: [] as any[] }))
  const practice = practiceResult.rows[0]
  if (!practice) return new NextResponse('Invalid token', { status: 401 })

  // Last 30 days onwards, joined with patient name/phone for display.
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const apptsResult = await pool.query(
    `SELECT a.id, a.scheduled_for, a.duration_minutes, a.status, a.notes,
            p.first_name, p.last_name, p.preferred_name, p.phone
       FROM appointments a
       LEFT JOIN patients p ON p.id = a.patient_id
      WHERE a.practice_id = $1
        AND a.status <> 'cancelled'
        AND a.scheduled_for >= $2
      ORDER BY a.scheduled_for ASC`,
    [practice.id, since.toISOString()],
  )

  const now = formatDate(new Date())
  const calName = escapeIcal(`Harbor - ${practice.name}`)

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Harbor//Harbor//EN',
    `X-WR-CALNAME:${calName}`,
    'X-WR-TIMEZONE:America/New_York',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
  ]

  for (const appt of apptsResult.rows) {
    const patientName =
      appt.preferred_name ||
      [appt.first_name, appt.last_name].filter(Boolean).join(' ') ||
      'Patient'
    const start = new Date(appt.scheduled_for)
    const end = new Date(start.getTime() + (appt.duration_minutes || 60) * 60_000)

    const descParts = [`Patient: ${patientName}`]
    if (appt.phone) descParts.push(`Phone: ${appt.phone}`)
    if (appt.notes) descParts.push(`Notes: ${appt.notes}`)

    lines.push('BEGIN:VEVENT')
    lines.push(`DTSTART:${formatDate(start)}`)
    lines.push(`DTEND:${formatDate(end)}`)
    lines.push(`SUMMARY:${escapeIcal(patientName)}`)
    lines.push(`DESCRIPTION:${escapeIcal(descParts.join('\n'))}`)
    lines.push(`UID:harbor-${appt.id}@harborreceptionist.com`)
    lines.push(`DTSTAMP:${now}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  const body = lines.map(foldLine).join('\r\n') + '\r\n'

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="harbor-calendar.ics"',
      'Cache-Control': 'no-cache, no-store',
    },
  })
}
