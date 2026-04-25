// app/api/ehr/assessments/assign/route.ts
// Therapist assigns an instrument to a patient. Creates a patient_assessments
// row with status='pending' that the patient will complete via their portal.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'
import { getInstrument } from '@/lib/ehr/instruments'

const DEFAULT_WINDOW_DAYS = 14

export async function POST(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const body = await req.json().catch(() => null)
  if (!body?.patient_id || !body?.assessment_type) {
    return NextResponse.json({ error: 'patient_id and assessment_type required' }, { status: 400 })
  }
  const inst = getInstrument(body.assessment_type)
  if (!inst) return NextResponse.json({ error: `Unknown instrument ${body.assessment_type}` }, { status: 400 })

  // Patient belongs to caller's practice?
  const { data: patient } = await supabaseAdmin
    .from('patients').select('id, practice_id, first_name, last_name')
    .eq('id', body.patient_id).maybeSingle()
  if (!patient || patient.practice_id !== auth.practiceId) {
    return NextResponse.json({ error: 'Patient not found for this practice' }, { status: 404 })
  }

  const expires = new Date(Date.now() + (body.window_days ?? DEFAULT_WINDOW_DAYS) * 24 * 60 * 60 * 1000)

  const { data, error } = await supabaseAdmin
    .from('patient_assessments')
    .insert({
      practice_id: auth.practiceId,
      patient_id: body.patient_id,
      patient_name: `${patient.first_name} ${patient.last_name}`.trim(),
      assessment_type: inst.id,
      status: 'pending',
      administered_via: body.via || 'portal',
      assigned_at: new Date().toISOString(),
      assigned_by: auth.user.id,
      expires_at: expires.toISOString(),
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId,
    action: 'note.create',
    resourceId: data.id,
    details: { kind: 'assessment_assigned', instrument: inst.id, patient_id: patient.id, expires_at: expires.toISOString() },
  })

  return NextResponse.json({ assessment: data }, { status: 201 })
}
