// app/api/ehr/notes/draft-from-brief/route.ts
// Primary AI-draft route. Therapist types a short brief; Sonnet expands
// into a full SOAP draft using patient history for context.
//
// POST body: { patient_id: string, brief: string }
// Response:  { note: <newly-created draft row>, summary, flagged_concerns }

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'
import { draftNoteFromBrief, type HistoryContext } from '@/lib/ehr/draft-note'

export async function POST(req: NextRequest) {
  const auth = await requireEhrAuth()
  if (isAuthError(auth)) return auth

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const patientId = body?.patient_id
  const brief = body?.brief

  if (!patientId || typeof patientId !== 'string') {
    return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
  }
  if (!brief || typeof brief !== 'string' || brief.trim().length < 4) {
    return NextResponse.json({ error: 'brief is required (at least a few words)' }, { status: 400 })
  }

  // Verify patient belongs to caller's practice.
  const { data: patient } = await supabaseAdmin
    .from('patients')
    .select('id, practice_id, first_name, last_name, reason_for_seeking')
    .eq('id', patientId)
    .maybeSingle()

  if (!patient || patient.practice_id !== auth.practiceId) {
    return NextResponse.json({ error: 'Patient not found for this practice' }, { status: 404 })
  }

  // Gather thin history context — last 3 progress notes + recent assessments.
  const history: HistoryContext = {}
  try {
    const { data: recent } = await supabaseAdmin
      .from('ehr_progress_notes')
      .select('title, note_format, created_at, assessment, plan')
      .eq('practice_id', auth.practiceId)
      .eq('patient_id', patientId)
      .in('status', ['signed', 'amended'])
      .order('created_at', { ascending: false })
      .limit(3)
    if (recent && recent.length) {
      history.recent_notes = recent.map((n: any) => ({
        title: n.title,
        note_format: n.note_format,
        created_at: new Date(n.created_at).toLocaleDateString(),
        assessment: n.assessment,
        plan: n.plan,
      }))
    }
  } catch {}

  try {
    const { data: assessments } = await supabaseAdmin
      .from('patient_assessments')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(5)
    if (assessments && assessments.length) {
      history.recent_assessments = assessments.map((a: any) => ({
        instrument: a.instrument || a.type || a.assessment_type || 'assessment',
        score: a.score ?? a.total ?? a.value ?? '',
        date: a.created_at ? new Date(a.created_at).toLocaleDateString() : '',
      }))
    }
  } catch {
    // patient_assessments schema varies — if columns aren't what we guessed, skip.
  }

  let draft
  try {
    draft = await draftNoteFromBrief({
      brief: brief.trim(),
      patientContext: {
        first_name: patient.first_name,
        last_name: patient.last_name,
        reason_for_seeking: patient.reason_for_seeking,
      },
      history,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Draft generation failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const { data, error } = await supabaseAdmin
    .from('ehr_progress_notes')
    .insert({
      practice_id: auth.practiceId,
      patient_id: patientId,
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
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await auditEhrAccess({
    user: auth.user,
    practiceId: auth.practiceId,
    action: 'note.draft_from_brief',
    resourceId: data.id,
    details: { patient_id: patientId, brief_length: brief.length, flagged_concerns: draft.flagged_concerns },
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
