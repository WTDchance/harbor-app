// app/api/portal/me/route.ts — returns the patient's portal dashboard data.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPortalSession } from '@/lib/ehr/portal'

export async function GET() {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { patient_id, practice_id } = session

  const [patient, practice, appts, consents, plan] = await Promise.all([
    supabaseAdmin.from('patients').select('id, first_name, last_name, email, phone, insurance').eq('id', patient_id).maybeSingle(),
    supabaseAdmin.from('practices').select('id, name, phone_number').eq('id', practice_id).maybeSingle(),
    supabaseAdmin
      .from('appointments')
      .select('id, appointment_date, appointment_time, duration_minutes, appointment_type, status, telehealth_room_slug')
      .eq('practice_id', practice_id).eq('patient_id', patient_id)
      .gte('appointment_date', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
      .order('appointment_date', { ascending: true }).order('appointment_time', { ascending: true })
      .limit(10),
    supabaseAdmin
      .from('ehr_consents').select('id, consent_type, version, status, document_name, signed_at')
      .eq('practice_id', practice_id).eq('patient_id', patient_id)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('ehr_treatment_plans').select('id, title, presenting_problem, goals, frequency, start_date, review_date, status')
      .eq('practice_id', practice_id).eq('patient_id', patient_id).eq('status', 'active').maybeSingle(),
  ])

  return NextResponse.json({
    patient: patient.data,
    practice: practice.data,
    appointments: appts.data ?? [],
    consents: consents.data ?? [],
    active_treatment_plan: plan.data ?? null,
  })
}
