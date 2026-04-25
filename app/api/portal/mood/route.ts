// app/api/portal/mood/route.ts — patient logs a mood check-in.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPortalSession } from '@/lib/ehr/portal'

export async function GET() {
  const s = await getPortalSession(); if (!s) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const { data } = await supabaseAdmin
    .from('ehr_mood_logs')
    .select('id, mood, anxiety, sleep_hours, note, logged_at')
    .eq('practice_id', s.practice_id).eq('patient_id', s.patient_id)
    .order('logged_at', { ascending: false })
    .limit(30)
  return NextResponse.json({ logs: data ?? [] })
}

export async function POST(req: NextRequest) {
  const s = await getPortalSession(); if (!s) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const mood = Number(body?.mood)
  if (!Number.isInteger(mood) || mood < 1 || mood > 10) {
    return NextResponse.json({ error: 'mood must be 1-10' }, { status: 400 })
  }
  const anxiety = body?.anxiety != null ? Number(body.anxiety) : null
  if (anxiety != null && (!Number.isInteger(anxiety) || anxiety < 1 || anxiety > 10)) {
    return NextResponse.json({ error: 'anxiety must be 1-10' }, { status: 400 })
  }
  const sleep = body?.sleep_hours != null ? Number(body.sleep_hours) : null
  const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null

  const { data, error } = await supabaseAdmin
    .from('ehr_mood_logs')
    .insert({
      practice_id: s.practice_id,
      patient_id: s.patient_id,
      mood, anxiety, sleep_hours: sleep, note,
    })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ log: data }, { status: 201 })
}
