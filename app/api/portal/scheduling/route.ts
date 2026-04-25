// Patient portal — scheduling requests submitted by the signed-in patient.
//
// GET → list the patient's existing requests.
// POST → patient submits new request. preferred_windows must be a non-empty
//        array of { date, start, end } objects. Defaults: 45 min,
//        appointment_type 'follow-up'. Status starts at 'pending'; the
//        therapist responds via the dashboard.
//
// TODO(notification): when the therapist-side notification fan-out lands
// (email/SMS that a new scheduling request arrived), wire it here. For
// now the request shows up in the dashboard inbox on next page load.

import { NextResponse, type NextRequest } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const { rows } = await pool
    .query(
      `SELECT id, preferred_windows, patient_note, therapist_note,
              duration_minutes, appointment_type, status, appointment_id,
              created_at, responded_at
         FROM ehr_scheduling_requests
        WHERE practice_id = $1 AND patient_id = $2
        ORDER BY created_at DESC`,
      [sess.practiceId, sess.patientId],
    )
    .catch(() => ({ rows: [] as any[] }))

  auditPortalAccess({
    session: sess,
    action: 'portal.scheduling.list',
    resourceType: 'ehr_scheduling_request',
    details: { count: rows.length },
  }).catch(() => {})

  return NextResponse.json({ requests: rows })
}

export async function POST(req: NextRequest) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const body = await req.json().catch(() => null) as any
  const windows = Array.isArray(body?.preferred_windows) ? body.preferred_windows : []
  if (windows.length === 0) {
    return NextResponse.json(
      { error: 'At least one preferred window required' },
      { status: 400 },
    )
  }

  const duration = Number.isFinite(Number(body?.duration_minutes))
    ? Math.max(15, Math.min(180, Number(body.duration_minutes)))
    : 45
  const appointmentType = typeof body?.appointment_type === 'string' && body.appointment_type
    ? body.appointment_type
    : 'follow-up'
  const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null

  const { rows } = await pool.query(
    `INSERT INTO ehr_scheduling_requests (
       practice_id, patient_id, preferred_windows, patient_note,
       duration_minutes, appointment_type, status
     ) VALUES (
       $1, $2, $3::jsonb, $4, $5, $6, 'pending'
     ) RETURNING *`,
    [
      sess.practiceId, sess.patientId,
      JSON.stringify(windows), note,
      duration, appointmentType,
    ],
  )
  const request = rows[0]

  auditPortalAccess({
    session: sess,
    action: 'portal.scheduling.create',
    resourceType: 'ehr_scheduling_request',
    resourceId: request.id,
    details: {
      window_count: windows.length,
      duration_minutes: duration,
      appointment_type: appointmentType,
    },
  }).catch(() => {})

  return NextResponse.json({ request }, { status: 201 })
}
