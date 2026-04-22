// app/api/ehr/notes/route.ts
// Harbor EHR — list + create progress notes.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function GET(req: NextRequest) {
  const auth = await requireEhrAuth()
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')
  const status = searchParams.get('status') // 'draft' | 'signed' | etc.
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10) || 100, 200)

  let query = supabaseAdmin
    .from('ehr_progress_notes')
    .select(
      'id, practice_id, patient_id, appointment_id, title, note_format, status, signed_at, signed_by, cpt_codes, icd10_codes, created_at, updated_at',
    )
    .eq('practice_id', auth.practiceId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (patientId) query = query.eq('patient_id', patientId)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  await auditEhrAccess({
    user: auth.user,
    practiceId: auth.practiceId,
    action: 'note.list',
    details: { patient_id: patientId ?? null, count: data?.length ?? 0 },
  })
  return NextResponse.json({ notes: data })
}

export async function POST(req: NextRequest) {
  const auth = await requireEhrAuth()
  if (isAuthError(auth)) return auth

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { patient_id, title, note_format, subjective, objective, assessment, plan, body: noteBody, appointment_id, therapist_id, cpt_codes, icd10_codes } = body

  if (!patient_id || typeof patient_id !== 'string') {
    return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
  }
  if (!title || typeof title !== 'string' || !title.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  // Verify the patient belongs to the caller's practice — protects against
  // creating notes against someone else's patient via ID guessing.
  const { data: patient } = await supabaseAdmin
    .from('patients')
    .select('id, practice_id')
    .eq('id', patient_id)
    .maybeSingle()
  if (!patient || patient.practice_id !== auth.practiceId) {
    return NextResponse.json({ error: 'Patient not found for this practice' }, { status: 404 })
  }

  const insertRow: any = {
    practice_id: auth.practiceId,
    patient_id,
    title: title.trim(),
    note_format: note_format || 'soap',
    subjective: subjective ?? null,
    objective: objective ?? null,
    assessment: assessment ?? null,
    plan: plan ?? null,
    body: noteBody ?? null,
    appointment_id: appointment_id ?? null,
    therapist_id: therapist_id ?? null,
    cpt_codes: Array.isArray(cpt_codes) ? cpt_codes : [],
    icd10_codes: Array.isArray(icd10_codes) ? icd10_codes : [],
    status: 'draft',
    created_by: auth.user.id,
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
    action: 'note.create',
    resourceId: data.id,
    details: { patient_id, title: insertRow.title, format: insertRow.note_format },
  })
  return NextResponse.json({ note: data }, { status: 201 })
}
