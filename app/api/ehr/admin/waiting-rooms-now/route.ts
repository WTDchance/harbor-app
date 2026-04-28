// app/api/ehr/admin/waiting-rooms-now/route.ts
//
// W47 T1 — list appointments where the patient is currently in the
// waiting room (entered ≤ 60min ago, therapist not yet joined).
// Powers the Today screen 'patient is here' surface.

import { NextResponse } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT a.id::text, a.scheduled_for::text, a.therapist_id::text,
            a.waiting_room_entered_at::text,
            p.first_name AS patient_first,
            p.last_name  AS patient_last,
            EXTRACT(EPOCH FROM (NOW() - a.waiting_room_entered_at))::int / 60 AS minutes_waiting
       FROM appointments a
       LEFT JOIN patients p ON p.id = a.patient_id
      WHERE a.practice_id = $1
        AND a.waiting_room_entered_at IS NOT NULL
        AND a.therapist_joined_meeting_at IS NULL
        AND a.waiting_room_entered_at >= NOW() - INTERVAL '60 minutes'
      ORDER BY a.waiting_room_entered_at ASC`,
    [ctx.practiceId],
  )
  return NextResponse.json({ in_waiting_room: rows })
}
