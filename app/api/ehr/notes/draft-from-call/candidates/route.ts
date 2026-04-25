// app/api/ehr/notes/draft-from-call/candidates/route.ts
// Lists recent call logs for a patient that have a transcript long enough
// to draft from. Used by the "Draft from call" modal on the patient detail.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'

const MIN_TRANSCRIPT_LEN = 50

export async function GET(req: NextRequest) {
  const auth = await requireEhrAuth()
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')
  if (!patientId) {
    return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('call_logs')
    .select(
      'id, created_at, duration_seconds, call_type, summary, transcript, crisis_detected',
    )
    .eq('practice_id', auth.practiceId)
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(25)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const calls = (data || [])
    .map((c) => ({
      id: c.id,
      created_at: c.created_at,
      duration_seconds: c.duration_seconds,
      call_type: c.call_type,
      summary: c.summary,
      has_transcript: !!(c.transcript && c.transcript.trim().length >= MIN_TRANSCRIPT_LEN),
      crisis_detected: c.crisis_detected,
    }))
    .filter((c) => c.has_transcript)

  return NextResponse.json({ calls })
}
