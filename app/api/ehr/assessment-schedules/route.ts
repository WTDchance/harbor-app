// app/api/ehr/assessment-schedules/route.ts
// Therapist sets up (or stops) a recurring assessment for a patient.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'
import { getInstrument } from '@/lib/ehr/instruments'

export async function GET(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')
  let q = supabaseAdmin
    .from('ehr_assessment_schedules')
    .select('id, patient_id, assessment_type, cadence_weeks, next_due_at, is_active, created_at')
    .eq('practice_id', auth.practiceId)
  if (patientId) q = q.eq('patient_id', patientId)
  const { data, error } = await q.order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ schedules: data ?? [] })
}

export async function POST(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const body = await req.json().catch(() => null)
  if (!body?.patient_id || !body?.assessment_type || !body?.cadence_weeks) {
    return NextResponse.json({ error: 'patient_id, assessment_type, cadence_weeks required' }, { status: 400 })
  }
  if (!getInstrument(body.assessment_type)) {
    return NextResponse.json({ error: 'Unknown instrument' }, { status: 400 })
  }
  const cadence = parseInt(body.cadence_weeks, 10)
  if (!Number.isInteger(cadence) || cadence < 1 || cadence > 52) {
    return NextResponse.json({ error: 'cadence_weeks must be 1-52' }, { status: 400 })
  }

  // Upsert schedule (unique on patient+type)
  const nextDue = new Date()
  const { data, error } = await supabaseAdmin
    .from('ehr_assessment_schedules')
    .upsert(
      {
        practice_id: auth.practiceId,
        patient_id: body.patient_id,
        assessment_type: body.assessment_type,
        cadence_weeks: cadence,
        next_due_at: nextDue.toISOString(),
        is_active: true,
        created_by: auth.user.id,
      },
      { onConflict: 'patient_id,assessment_type' },
    )
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.create',
    resourceId: data.id,
    details: { kind: 'assessment_schedule', instrument: body.assessment_type, cadence_weeks: cadence },
  })

  return NextResponse.json({ schedule: data }, { status: 201 })
}
