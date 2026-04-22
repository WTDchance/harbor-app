// app/api/ehr/safety-plans/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function GET(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')
  let q = supabaseAdmin
    .from('ehr_safety_plans').select('*')
    .eq('practice_id', auth.practiceId)
    .order('created_at', { ascending: false })
  if (patientId) q = q.eq('patient_id', patientId)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ plans: data })
}

export async function POST(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const body = await req.json().catch(() => null)
  if (!body?.patient_id) return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })

  // If activating, demote prior active.
  const wantActive = body.status === 'active' || body.status === undefined
  if (wantActive) {
    await supabaseAdmin
      .from('ehr_safety_plans').update({ status: 'revised' })
      .eq('practice_id', auth.practiceId).eq('patient_id', body.patient_id).eq('status', 'active')
  }

  const row = {
    practice_id: auth.practiceId,
    patient_id: body.patient_id,
    warning_signs: Array.isArray(body.warning_signs) ? body.warning_signs : [],
    internal_coping: Array.isArray(body.internal_coping) ? body.internal_coping : [],
    distraction_people_places: Array.isArray(body.distraction_people_places) ? body.distraction_people_places : [],
    support_contacts: Array.isArray(body.support_contacts) ? body.support_contacts : [],
    professional_contacts: Array.isArray(body.professional_contacts) ? body.professional_contacts : [],
    means_restriction: body.means_restriction ?? null,
    reasons_for_living: Array.isArray(body.reasons_for_living) ? body.reasons_for_living : [],
    status: wantActive ? 'active' : body.status,
    created_by: auth.user.id,
  }
  const { data, error } = await supabaseAdmin.from('ehr_safety_plans').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.create',
    resourceId: data.id, details: { kind: 'safety_plan', patient_id: body.patient_id },
  })
  return NextResponse.json({ plan: data }, { status: 201 })
}
