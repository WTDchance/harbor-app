// Calendar events for the dashboard.
//
// 2-tier port (per the wave-3 carve):
//   GET — DB-only events read. Returns the practice's appointments joined
//         to patients, shaped as { id, summary, startDate, endDate,
//         location, status }. The dashboard calendar view consumes this
//         directly. CalDAV pull is NOT performed on AWS yet — locally-
//         managed appointments are the source of truth in this slice.
//   POST — defer. Creating a CalDAV iCal object on the user's iCloud
//         calendar is a write to a 3rd-party server and lives in
//         phase-4b alongside the rest of the CalDAV sync work.
//
// Optional ?from=&to= ISO date range filter. Defaults to a window of
// (today − 7d, today + 60d) so the calendar view has something useful
// without a query param round-trip.

import { NextResponse, type NextRequest } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ events: [] })

  const sp = req.nextUrl.searchParams
  const fromIso = sp.get('from') ??
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const toIso = sp.get('to') ??
    new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()

  const { rows } = await pool.query(
    `SELECT a.id, a.scheduled_for, a.duration_minutes, a.status,
            a.appointment_type, a.notes,
            p.first_name, p.last_name, p.preferred_name
       FROM appointments a
       LEFT JOIN patients p ON p.id = a.patient_id
      WHERE a.practice_id = $1
        AND a.scheduled_for >= $2
        AND a.scheduled_for <= $3
        AND a.status <> 'cancelled'
      ORDER BY a.scheduled_for ASC
      LIMIT 500`,
    [ctx.practiceId, fromIso, toIso],
  )

  const events = rows.map(r => {
    const patientName =
      r.preferred_name ||
      [r.first_name, r.last_name].filter(Boolean).join(' ') ||
      'Patient'
    const start = new Date(r.scheduled_for)
    const end = new Date(start.getTime() + (r.duration_minutes || 50) * 60_000)
    return {
      id: r.id,
      summary: patientName,
      description: r.notes ?? null,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      status: r.status,
      appointmentType: r.appointment_type,
    }
  })

  return NextResponse.json({ events })
}

// TODO(phase-4b): port POST. Creates an iCal VEVENT and pushes via tsdav
// into the linked CalDAV calendar. Held back with the rest of CalDAV
// sync; AWS-side appointments are the source of truth for now.
export async function POST() {
  return NextResponse.json(
    { error: 'calendar_event_create_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
