// app/api/ehr/telehealth/[id]/status/route.ts
//
// W49 D2 — therapist polling endpoint. Returns the live session row.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const { rows } = await pool.query(
    `SELECT s.id, s.appointment_id, s.patient_status, s.therapist_status,
            s.therapist_message, s.jitsi_room_id, s.started_at, s.admitted_at, s.ended_at,
            a.scheduled_for, p.first_name AS patient_first_name,
            p.last_name AS patient_last_name, a.video_provider, a.video_meeting_id
       FROM telehealth_sessions s
       JOIN appointments a ON a.id = s.appointment_id
       LEFT JOIN patients p ON p.id = a.patient_id
      WHERE s.id = $1 AND s.practice_id = $2
      LIMIT 1`,
    [id, ctx.practiceId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({ session: rows[0] })
}
