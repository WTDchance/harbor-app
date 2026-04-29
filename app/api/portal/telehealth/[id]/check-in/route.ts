// app/api/portal/telehealth/[id]/check-in/route.ts
//
// W49 D2 — patient checks in for a telehealth appointment from the
// portal. Creates or finds an active session row for the appointment
// and flips patient_status to 'in_waiting'.

import { NextResponse, type NextRequest } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess
  const { id: appointmentId } = await params

  // Verify appointment belongs to this patient.
  const apt = await pool.query(
    `SELECT id, video_meeting_id, telehealth_room_slug, scheduled_for, video_provider
       FROM appointments
      WHERE id = $1 AND practice_id = $2 AND patient_id = $3
      LIMIT 1`,
    [appointmentId, sess.practiceId, sess.patientId],
  )
  if (apt.rows.length === 0) return NextResponse.json({ error: 'appointment_not_found' }, { status: 404 })

  // Reuse active session if any; else create one in 'in_waiting'.
  const existing = await pool.query(
    `SELECT id, patient_status, therapist_status, therapist_message, jitsi_room_id, admitted_at
       FROM telehealth_sessions
      WHERE appointment_id = $1 AND practice_id = $2 AND ended_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [appointmentId, sess.practiceId],
  )

  let row: any
  if (existing.rows.length > 0) {
    const upd = await pool.query(
      `UPDATE telehealth_sessions
          SET patient_status = CASE WHEN patient_status = 'left' THEN 'in_waiting'
                                    WHEN patient_status IN ('invited') THEN 'in_waiting'
                                    ELSE patient_status END
        WHERE id = $1
        RETURNING id, patient_status, therapist_status, therapist_message, jitsi_room_id, admitted_at`,
      [existing.rows[0].id],
    )
    row = upd.rows[0]
  } else {
    const ins = await pool.query(
      `INSERT INTO telehealth_sessions
         (practice_id, appointment_id, jitsi_room_id, patient_status, started_at)
       VALUES ($1, $2, $3, 'in_waiting', NOW())
       RETURNING id, patient_status, therapist_status, therapist_message, jitsi_room_id, admitted_at`,
      [sess.practiceId, appointmentId, apt.rows[0].video_meeting_id ?? apt.rows[0].telehealth_room_slug ?? null],
    )
    row = ins.rows[0]
  }

  await auditPortalAccess({
    session: sess,
    action: 'telehealth.patient_checked_in',
    resourceType: 'telehealth_session',
    resourceId: row.id,
    details: { appointment_id: appointmentId },
  }).catch(() => null)

  return NextResponse.json({ session: row })
}
