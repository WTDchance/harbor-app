// MIGRATION REQUIRED: ALTER TABLE practices ADD COLUMN IF NOT EXISTS calendar_token TEXT UNIQUE;
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

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
  if (!token) {
    return new NextResponse('Missing token', { status: 400 })
  }

  // Look up practice by calendar token
  const { data: practice, error } = await supabaseAdmin
    .from('practices')
    .select('id, name')
    .eq('calendar_token', token)
    .single()

  if (error || !practice) {
    return new NextResponse('Invalid token', { status: 401 })
  }

  // Get appointments from last 30 days onwards
  const since = new Date()
  since.setDate(since.getDate() - 30)

  const { data: appointments } = await supabaseAdmin
    .from('appointments')
    .select('id, scheduled_at, duration_minutes, status, notes, patient_name, patient_phone')
    .eq('practice_id', practice.id)
    .neq('status', 'cancelled')
    .gte('scheduled_at', since.toISOString())
    .order('scheduled_at', { ascending: true })

  const now = formatDate(new Date())
  const calName = escapeIcal(`Harbor - ${practice.name}`)

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Harbor Receptionist//Harbor//EN',
    `X-WR-CALNAME:${calName}`,
    'X-WR-TIMEZONE:America/New_York',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
  ]

  for (const appt of appointments || []) {
    const patientName = appt.patient_name || 'Patient'
    const start = new Date(appt.scheduled_at)
    const end = new Date(start.getTime() + (appt.duration_minutes || 60) * 60000)

    const descParts = [`Patient: ${patientName}`]
    if (appt.patient_phone) descParts.push(`Phone: ${appt.patient_phone}`)
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
