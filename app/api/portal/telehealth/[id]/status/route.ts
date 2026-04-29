// app/api/portal/telehealth/[id]/status/route.ts
//
// W49 D2 — patient polls session status while sitting in the waiting room.

import { NextResponse, type NextRequest } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess
  const { id: appointmentId } = await params

  const { rows } = await pool.query(
    `SELECT s.id, s.appointment_id, s.patient_status, s.therapist_status,
            s.therapist_message, s.jitsi_room_id, s.admitted_at, s.ended_at,
            a.scheduled_for, a.video_provider, a.video_meeting_id
       FROM telehealth_sessions s
       JOIN appointments a ON a.id = s.appointment_id
      WHERE s.appointment_id = $1 AND s.practice_id = $2 AND a.patient_id = $3
        AND s.ended_at IS NULL
      ORDER BY s.created_at DESC
      LIMIT 1`,
    [appointmentId, sess.practiceId, sess.patientId],
  )
  if (rows.length === 0) {
    // Fallback: confirm appointment exists + return a pre-checkin shell.
    const apt = await pool.query(
      `SELECT id, scheduled_for, video_provider, video_meeting_id
         FROM appointments
        WHERE id = $1 AND practice_id = $2 AND patient_id = $3 LIMIT 1`,
      [appointmentId, sess.practiceId, sess.patientId],
    )
    if (apt.rows.length === 0) return NextResponse.json({ error: 'appointment_not_found' }, { status: 404 })
    return NextResponse.json({
      session: null,
      appointment: apt.rows[0],
    })
  }
  return NextResponse.json({ session: rows[0] })
}
