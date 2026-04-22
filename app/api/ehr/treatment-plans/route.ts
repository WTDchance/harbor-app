// app/api/ehr/treatment-plans/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function GET(req: NextRequest) {
  const auth = await requireEhrAuth()
  if (isAuthError(auth)) return auth
  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')
  let q = supabaseAdmin
    .from('ehr_treatment_plans')
    .select('id, patient_id, title, presenting_problem, diagnoses, goals, status, start_date, review_date, signed_at, created_at, updated_at')
    .eq('practice_id', auth.practiceId)
    .order('created_at', { ascending: false })
  if (patientId) q = q.eq('patient_id', patientId)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ plans: data })
}

export async function POST(req: NextRequest) {
  const auth = await requireEhrAuth()
  if (isAuthError(auth)) return auth
  const body = await req.json().catch(() => null)
  if (!body?.patient_id) return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })

  // If the caller wants this plan active, demote any existing active plan for the patient first.
  const wantActive = body.status === 'active' || body.status === undefined
  if (wantActive) {
    await supabaseAdmin
      .from('ehr_treatment_plans')
      .update({ status: 'revised' })
      .eq('practice_id', auth.practiceId)
      .eq('patient_id', body.patient_id)
      .eq('status', 'active')
  }

  const insertRow = {
    practice_id: auth.practiceId,
    patient_id: body.patient_id,
    title: body.title || 'Treatment plan',
    presenting_problem: body.presenting_problem ?? null,
    diagnoses: Array.isArray(body.diagnoses) ? body.diagnoses : [],
    goals: Array.isArray(body.goals) ? body.goals : [],
    frequency: body.frequency ?? null,
    start_date: body.start_date ?? null,
    review_date: body.review_date ?? null,
    status: wantActive ? 'active' : body.status,
    created_by: auth.user.id,
  }
  const { data, error } = await supabaseAdmin
    .from('ehr_treatment_plans').insert(insertRow).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId,
    action: 'note.create', // reusing existing enum; refine later
    resourceId: data.id, details: { kind: 'treatment_plan', patient_id: body.patient_id },
  })
  return NextResponse.json({ plan: data }, { status: 201 })
}
