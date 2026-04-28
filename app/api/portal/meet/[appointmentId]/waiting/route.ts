// app/api/portal/meet/[appointmentId]/waiting/route.ts
//
// W47 T1 — patient waiting room. Polled by the page once a few seconds
// to learn when the therapist has joined.
//
// POST { event: 'entered' | 'abandoned' } — records waiting room
//   transitions for analytics + audit.
// GET — returns appointment summary + therapist_joined flag.

import { NextResponse, type NextRequest } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { appointmentId: string } }) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const { rows } = await pool.query(
    `SELECT a.id::text, a.scheduled_for::text, a.duration_minutes,
            a.status, a.waiting_room_entered_at, a.therapist_joined_meeting_at,
            t.first_name AS therapist_first, t.last_name AS therapist_last,
            p.name AS practice_name
       FROM appointments a
       LEFT JOIN therapists t ON t.id = a.therapist_id
       LEFT JOIN practices  p ON p.id = a.practice_id
      WHERE a.id = $1 AND a.practice_id = $2 AND a.patient_id = $3
      LIMIT 1`,
    [params.appointmentId, sess.practiceId, sess.patientId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ appointment: rows[0] })
}

export async function POST(req: NextRequest, { params }: { params: { appointmentId: string } }) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const body = await req.json().catch(() => null)
  const event = body?.event === 'abandoned' ? 'abandoned'
              : body?.event === 'joined_session' ? 'joined_session'
              : 'entered'

  // Verify ownership.
  const own = await pool.query(
    `SELECT 1 FROM appointments
      WHERE id = $1 AND practice_id = $2 AND patient_id = $3 LIMIT 1`,
    [params.appointmentId, sess.practiceId, sess.patientId],
  )
  if (own.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (event === 'entered') {
    await pool.query(
      `UPDATE appointments
          SET waiting_room_entered_at = COALESCE(waiting_room_entered_at, NOW())
        WHERE id = $1`,
      [params.appointmentId],
    )
  }

  await auditPortalAccess({
    session: sess,
    action: event === 'entered' ? 'portal.telehealth.waiting_room.entered'
          : event === 'joined_session' ? 'portal.telehealth.waiting_room.joined_session'
          : 'portal.telehealth.waiting_room.abandoned',
    resourceType: 'appointment',
    resourceId: params.appointmentId,
    details: {},
  })

  return NextResponse.json({ ok: true })
}
