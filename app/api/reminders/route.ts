// app/api/reminders/route.ts
//
// Wave 23 (AWS port). Persist a reminder send-request to the
// reminders table. Twilio dispatch is on Bucket 1 (carrier swap) —
// the cron worker that processes the reminders queue will pick this
// up once Retell+SignalWire land. Cookie auth via Cognito session.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { getEffectivePracticeId } from '@/lib/active-practice'

export async function POST(request: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const { patient_phone, patient_name, appointment_time, session_type } = body
  if (!patient_phone || !appointment_time) {
    return NextResponse.json(
      { error: 'patient_phone and appointment_time required' },
      { status: 400 },
    )
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO reminders
          (practice_id, patient_phone, patient_name, scheduled_for,
           session_type, status, queued_at)
        VALUES ($1, $2, $3, $4, $5, 'queued', NOW())
        RETURNING id, status`,
      [practiceId, patient_phone, patient_name ?? null, appointment_time, session_type ?? null],
    )
    return NextResponse.json({
      ok: true,
      reminder_id: rows[0].id,
      status: rows[0].status,
      carrier_dispatch: 'deferred_to_bucket_1',
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
