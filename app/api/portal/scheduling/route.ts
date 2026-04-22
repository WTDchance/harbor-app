// app/api/portal/scheduling/route.ts — patient creates a scheduling request.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPortalSession } from '@/lib/ehr/portal'

export async function GET() {
  const s = await getPortalSession(); if (!s) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const { data, error } = await supabaseAdmin
    .from('ehr_scheduling_requests')
    .select('id, preferred_windows, patient_note, therapist_note, duration_minutes, appointment_type, status, appointment_id, created_at, responded_at')
    .eq('practice_id', s.practice_id).eq('patient_id', s.patient_id)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requests: data ?? [] })
}

export async function POST(req: NextRequest) {
  const s = await getPortalSession(); if (!s) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const windows = Array.isArray(body?.preferred_windows) ? body.preferred_windows : []
  if (windows.length === 0) {
    return NextResponse.json({ error: 'At least one preferred window required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('ehr_scheduling_requests')
    .insert({
      practice_id: s.practice_id,
      patient_id: s.patient_id,
      preferred_windows: windows,
      patient_note: body?.note || null,
      duration_minutes: body?.duration_minutes || 45,
      appointment_type: body?.appointment_type || 'follow-up',
      status: 'pending',
    }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ request: data }, { status: 201 })
}
