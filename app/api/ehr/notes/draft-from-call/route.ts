// app/api/ehr/notes/draft-from-call/route.ts
// Harbor EHR — draft a progress note from a call transcript via Claude Sonnet.
//
// POST body: { call_log_id: string }
// Response:  { note: <newly-created draft row> }

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'
import { draftNoteFromTranscript } from '@/lib/ehr/draft-note'

export async function POST(req: NextRequest) {
  const auth = await requireEhrAuth()
  if (isAuthError(auth)) return auth

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const callLogId = body?.call_log_id
  if (!callLogId || typeof callLogId !== 'string') {
    return NextResponse.json({ error: 'call_log_id is required' }, { status: 400 })
  }

  // Load the call, confirm it belongs to the caller's practice, and has a
  // transcript + a linked patient.
  const { data: call } = await supabaseAdmin
    .from('call_logs')
    .select(
      'id, practice_id, patient_id, patient_phone, transcript, summary, call_type, session_type, duration_seconds, created_at, caller_name, reason_for_calling, crisis_detected',
    )
    .eq('id', callLogId)
    .maybeSingle()

  if (!call || call.practice_id !== auth.practiceId) {
    return NextResponse.json({ error: 'Call not found for this practice' }, { status: 404 })
  }
  if (!call.patient_id) {
    return NextResponse.json(
      { error: 'This call is not linked to a patient. Link it first.' },
      { status: 400 },
    )
  }
  if (!call.transcript || call.transcript.trim().length < 50) {
    return NextResponse.json(
      { error: 'Call has no transcript or the transcript is too short to draft from.' },
      { status: 400 },
    )
  }

  // Fetch patient context for the prompt.
  const { data: patient } = await supabaseAdmin
    .from('patients')
    .select('id, first_name, last_name')
    .eq('id', call.patient_id)
    .maybeSingle()

  // Draft via Sonnet.
  let draft
  try {
    draft = await draftNoteFromTranscript({
      transcript: call.transcript,
      callMetadata: {
        call_type: call.call_type,
        session_type: call.session_type,
        duration_seconds: call.duration_seconds,
        created_at: call.created_at,
        caller_name: call.caller_name,
        reason_for_calling: call.reason_for_calling,
        crisis_detected: call.crisis_detected,
      },
      patientContext: patient
        ? { first_name: patient.first_name, last_name: patient.last_name }
        : undefined,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Draft generation failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // Insert the draft note. Always status='draft' — therapist signs manually.
  const insertRow = {
    practice_id: auth.practiceId,
    patient_id: call.patient_id,
    title: draft.title,
    note_format: 'soap',
    subjective: draft.subjective,
    objective: draft.objective,
    assessment: draft.assessment,
    plan: draft.plan,
    cpt_codes: draft.suggested_cpt_codes,
    icd10_codes: draft.suggested_icd10_codes,
    status: 'draft',
    created_by: auth.user.id,
    drafted_from_call_id: call.id,
  }

  const { data, error } = await supabaseAdmin
    .from('ehr_progress_notes')
    .insert(insertRow)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await auditEhrAccess({
    user: auth.user,
    practiceId: auth.practiceId,
    action: 'note.draft_from_call',
    resourceId: data.id,
    details: { call_log_id: call.id, flagged_concerns: draft.flagged_concerns },
  })

  return NextResponse.json(
    {
      note: data,
      summary: draft.summary_for_review,
      flagged_concerns: draft.flagged_concerns,
    },
    { status: 201 },
  )
}
