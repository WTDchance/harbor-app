// app/api/ehr/appointments/conflicts/route.ts
// Detect scheduling conflicts. Used by the appointments UI before
// confirming a new appointment.
//
// GET ?date=YYYY-MM-DD&time=HH:MM&duration=45&exclude_id=...
// Returns appointments on the same date that overlap with the
// proposed window. Same-practice only.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export async function GET(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')
  const time = searchParams.get('time')
  const duration = Math.max(5, Math.min(480, parseInt(searchParams.get('duration') || '45', 10) || 45))
  const excludeId = searchParams.get('exclude_id')
  if (!date || !time) return NextResponse.json({ error: 'date and time required' }, { status: 400 })

  const start = toMinutes(time)
  const end = start + duration

  let q = supabaseAdmin
    .from('appointments')
    .select('id, appointment_date, appointment_time, duration_minutes, patient_name, status')
    .eq('practice_id', auth.practiceId)
    .eq('appointment_date', date)
    .in('status', ['scheduled', 'confirmed'])
  if (excludeId) q = q.neq('id', excludeId)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const conflicts = (data ?? []).filter((a) => {
    const s = toMinutes((a.appointment_time as string).slice(0, 5))
    const e = s + (a.duration_minutes || 45)
    // overlap iff (startA < endB) && (endA > startB)
    return start < e && end > s
  })

  return NextResponse.json({
    conflicts: conflicts.map((c) => ({
      id: c.id,
      time: (c.appointment_time as string).slice(0, 5),
      duration_minutes: c.duration_minutes,
      patient_name: c.patient_name,
      status: c.status,
    })),
  })
}
