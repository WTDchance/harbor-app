// app/api/ehr/appointments/[id]/start-telehealth/route.ts
//
// W49 D2 — therapist creates (or returns the existing active) waiting-
// room session for an appointment. Idempotent: returns an in-flight
// session if one exists, mints a new one otherwise. Does NOT yet
// admit the patient — the therapist must call /admit explicitly.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: appointmentId } = await params

  // Verify appointment.
  const apt = await pool.query(
    `SELECT id, video_meeting_id, video_provider, telehealth_room_slug
       FROM appointments
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [appointmentId, ctx.practiceId],
  )
  if (apt.rows.length === 0) return NextResponse.json({ error: 'appointment_not_found' }, { status: 404 })

  // Reuse an in-flight session if any.
  const live = await pool.query(
    `SELECT id, patient_status, therapist_status, jitsi_room_id, started_at, admitted_at, ended_at
       FROM telehealth_sessions
      WHERE appointment_id = $1 AND practice_id = $2 AND ended_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [appointmentId, ctx.practiceId],
  )
  if (live.rows.length > 0) {
    return NextResponse.json({ session: live.rows[0], reused: true })
  }

  const room = apt.rows[0].video_meeting_id ?? apt.rows[0].telehealth_room_slug ?? null
  const ins = await pool.query(
    `INSERT INTO telehealth_sessions
       (practice_id, appointment_id, jitsi_room_id, started_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING id, patient_status, therapist_status, jitsi_room_id, started_at, admitted_at, ended_at`,
    [ctx.practiceId, appointmentId, room],
  )

  await auditEhrAccess({
    ctx,
    action: 'telehealth.session_started',
    resourceType: 'telehealth_session',
    resourceId: ins.rows[0].id,
    details: { appointment_id: appointmentId, video_provider: apt.rows[0].video_provider ?? null },
  })

  return NextResponse.json({ session: ins.rows[0], reused: false }, { status: 201 })
}
