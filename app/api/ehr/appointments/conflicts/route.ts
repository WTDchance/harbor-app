// app/api/ehr/appointments/conflicts/route.ts
//
// Wave 22 (AWS port). Detect scheduling conflicts. Used by the
// appointments UI before confirming a new slot.
//
// AWS schema: appointments.scheduled_for (timestamptz). The legacy
// query keyed off (appointment_date, appointment_time) — we now
// derive both from scheduled_for + duration_minutes.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')
  const time = searchParams.get('time')
  const duration = Math.max(5, Math.min(480, parseInt(searchParams.get('duration') || '45', 10) || 45))
  const excludeId = searchParams.get('exclude_id')
  if (!date || !time) return NextResponse.json({ error: 'date and time required' }, { status: 400 })

  // Build the proposed window in UTC (caller passes local clock — the UI
  // is practice-tz scoped, so this matches legacy semantics).
  const startIso = `${date}T${time.length === 5 ? time + ':00' : time}Z`
  const startMs = new Date(startIso).getTime()
  if (Number.isNaN(startMs)) return NextResponse.json({ error: 'invalid date/time' }, { status: 400 })
  const endIso = new Date(startMs + duration * 60_000).toISOString()
  const dayStart = new Date(`${date}T00:00:00Z`).toISOString()
  const dayEnd = new Date(`${date}T23:59:59Z`).toISOString()

  const params: any[] = [ctx.practiceId, dayStart, dayEnd]
  let where = `practice_id = $1
        AND scheduled_for >= $2 AND scheduled_for <= $3
        AND status IN ('scheduled','confirmed')`
  if (excludeId) {
    params.push(excludeId)
    where += ` AND id <> $${params.length}`
  }

  const { rows } = await pool.query(
    `SELECT id, scheduled_for, duration_minutes, patient_name, status
       FROM appointments WHERE ${where}`,
    params,
  )

  const conflicts = rows
    .map((a: any) => {
      const s = new Date(a.scheduled_for).getTime()
      const e = s + (a.duration_minutes || 45) * 60_000
      const overlap = startMs < e && new Date(endIso).getTime() > s
      return overlap ? a : null
    })
    .filter(Boolean)

  return NextResponse.json({
    conflicts: conflicts.map((c: any) => ({
      id: c.id,
      time: new Date(c.scheduled_for).toISOString().slice(11, 16),
      duration_minutes: c.duration_minutes,
      patient_name: c.patient_name,
      status: c.status,
    })),
  })
}
