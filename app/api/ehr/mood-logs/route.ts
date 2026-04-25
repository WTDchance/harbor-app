// app/api/ehr/mood-logs/route.ts — therapist reads a patient's mood log history.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'

export async function GET(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')
  if (!patientId) return NextResponse.json({ error: 'patient_id required' }, { status: 400 })
  const { data, error } = await supabaseAdmin
    .from('ehr_mood_logs')
    .select('id, mood, anxiety, sleep_hours, note, logged_at')
    .eq('practice_id', auth.practiceId).eq('patient_id', patientId)
    .order('logged_at', { ascending: true })
    .limit(90)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ logs: data ?? [] })
}
