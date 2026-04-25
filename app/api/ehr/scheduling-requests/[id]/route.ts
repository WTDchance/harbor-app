// app/api/ehr/scheduling-requests/[id]/route.ts
// Therapist approves or declines a scheduling request. Approval can
// create an appointments row directly (choose one of the preferred
// windows or specify a scheduled_at).

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id } = await params
  const body = await req.json().catch(() => null)
  const action = body?.action // 'approve' | 'decline'
  if (action !== 'approve' && action !== 'decline') {
    return NextResponse.json({ error: 'action must be approve | decline' }, { status: 400 })
  }

  const { data: reqRow } = await supabaseAdmin
    .from('ehr_scheduling_requests').select('*').eq('id', id).eq('practice_id', auth.practiceId).maybeSingle()
  if (!reqRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (reqRow.status !== 'pending') return NextResponse.json({ error: 'Already handled' }, { status: 409 })

  if (action === 'decline') {
    const { data, error } = await supabaseAdmin
      .from('ehr_scheduling_requests')
      .update({
        status: 'declined',
        therapist_note: body?.note ?? null,
        responded_at: new Date().toISOString(),
        responded_by: auth.user.id,
      }).eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await auditEhrAccess({ user: auth.user, practiceId: auth.practiceId, action: 'note.update',
      resourceId: id, details: { kind: 'scheduling_request_declined' } })
    return NextResponse.json({ request: data })
  }

  // Approve — need appointment_date + appointment_time
  const apptDate = body?.appointment_date
  const apptTime = body?.appointment_time
  if (!apptDate || !apptTime) {
    return NextResponse.json({ error: 'appointment_date and appointment_time required to approve' }, { status: 400 })
  }

  // Load patient for appointments table legacy fields (patient_name / patient_phone)
  const { data: patient } = await supabaseAdmin
    .from('patients').select('first_name, last_name, phone').eq('id', reqRow.patient_id).maybeSingle()

  const { data: appt, error: apptErr } = await supabaseAdmin
    .from('appointments').insert({
      practice_id: auth.practiceId,
      patient_id: reqRow.patient_id,
      patient_name: patient ? `${patient.first_name} ${patient.last_name}`.trim() : null,
      patient_phone: patient?.phone ?? null,
      appointment_date: apptDate,
      appointment_time: apptTime,
      duration_minutes: reqRow.duration_minutes,
      appointment_type: reqRow.appointment_type,
      status: 'scheduled',
    }).select().single()
  if (apptErr) return NextResponse.json({ error: apptErr.message }, { status: 500 })

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('ehr_scheduling_requests')
    .update({
      status: 'approved',
      appointment_id: appt.id,
      therapist_note: body?.note ?? null,
      responded_at: new Date().toISOString(),
      responded_by: auth.user.id,
    }).eq('id', id).select().single()
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.update',
    resourceId: id, details: { kind: 'scheduling_request_approved', appointment_id: appt.id },
  })
  return NextResponse.json({ request: updated, appointment: appt })
}
