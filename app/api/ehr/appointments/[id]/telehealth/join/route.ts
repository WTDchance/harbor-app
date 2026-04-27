// app/api/ehr/appointments/[id]/telehealth/join/route.ts
//
// Wave 38 TS2 — therapist or patient hits this to get a Chime SDK
// JoinInfo blob: { Meeting, Attendee }. The browser feeds that to
// amazon-chime-sdk-js to actually connect to the meeting.
//
// Authn: tries therapist EHR session first, falls back to portal session
// (patient). If neither, 401.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { getPortalSession } from '@/lib/aws/portal-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import {
  createChimeMeeting,
  createChimeAttendee,
  getChimeMeeting,
} from '@/lib/aws/chime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function chimeEnabled(): boolean {
  return process.env.CHIME_ENABLED === '1' || process.env.CHIME_ENABLED === 'true'
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!chimeEnabled()) {
    return NextResponse.json({ error: 'chime_disabled' }, { status: 503 })
  }

  // 1) Try therapist session
  const therapistCtx = await requireEhrApiSession().catch(() => null)
  let role: 'therapist' | 'patient' = 'therapist'
  let externalUserId: string
  let practiceId: string | null = null
  let allowedAppointmentId: string | null = null

  if (therapistCtx && !(therapistCtx instanceof NextResponse)) {
    practiceId = therapistCtx.practiceId
    role = 'therapist'
    externalUserId = `therapist:${therapistCtx.user.id}`
    allowedAppointmentId = id
  } else {
    // 2) Try patient portal session
    const portal = await getPortalSession().catch(() => null) as any
    if (!portal?.patientId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    role = 'patient'
    externalUserId = `patient:${portal.patientId}`
    practiceId = portal.practiceId || null
    // Verify the appointment is for this patient
    const { rows } = await pool.query(
      `SELECT id FROM appointments
        WHERE id = $1 AND patient_id = $2 LIMIT 1`,
      [id, portal.patientId],
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    allowedAppointmentId = id
  }

  // 3) Look up / create Chime meeting
  const args: any[] = [allowedAppointmentId]
  let where = `id = $1`
  if (practiceId) { args.push(practiceId); where += ` AND practice_id = $2` }
  const { rows: aRows } = await pool.query(
    `SELECT id, video_meeting_id, video_provider FROM appointments WHERE ${where} LIMIT 1`,
    args,
  )
  if (!aRows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  let meetingId: string | null = aRows[0].video_meeting_id
  let meeting: any = null
  if (meetingId) meeting = await getChimeMeeting(meetingId)
  if (!meeting) {
    meeting = await createChimeMeeting({ externalMeetingId: allowedAppointmentId! })
    meetingId = meeting?.MeetingId || null
    if (!meetingId) return NextResponse.json({ error: 'chime_create_failed' }, { status: 502 })
    await pool.query(
      `UPDATE appointments
          SET video_meeting_id = $1, video_provider = 'chime'
        WHERE id = $2`,
      [meetingId, allowedAppointmentId],
    )
  }

  // 4) Mint attendee
  const attendee = await createChimeAttendee({
    meetingId: meetingId!,
    externalUserId,
  })

  // 5) Audit -- therapist side only
  if (therapistCtx && !(therapistCtx instanceof NextResponse)) {
    await auditEhrAccess({
      ctx: therapistCtx,
      action: 'note.view',
      resourceType: 'appointment',
      resourceId: allowedAppointmentId!,
      details: { kind: 'telehealth_chime_join', role: 'therapist' },
    })
  } else {
    // patient — best-effort log
    try {
      await pool.query(
        `INSERT INTO audit_logs (user_id, user_email, practice_id, action, resource_type, resource_id, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [null, null, practiceId, 'portal.appointment.telehealth_join', 'appointment', allowedAppointmentId, JSON.stringify({ role: 'patient' })],
      )
    } catch {}
  }

  return NextResponse.json({ Meeting: meeting, Attendee: attendee, role })
}
