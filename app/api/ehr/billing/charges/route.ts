// app/api/ehr/billing/charges/route.ts
// List and manually create charges.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'
import { feeForCpt } from '@/lib/ehr/billing'

export async function GET(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const patientId = searchParams.get('patient_id')
  const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10) || 200, 500)
  let q = supabaseAdmin
    .from('ehr_charges')
    .select('id, patient_id, note_id, appointment_id, cpt_code, units, fee_cents, allowed_cents, copay_cents, billed_to, status, service_date, place_of_service, created_at')
    .eq('practice_id', auth.practiceId)
    .order('service_date', { ascending: false })
    .limit(limit)
  if (status) q = q.eq('status', status)
  if (patientId) q = q.eq('patient_id', patientId)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ charges: data ?? [] })
}

export async function POST(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const body = await req.json().catch(() => null)
  if (!body?.patient_id || !body?.cpt_code) {
    return NextResponse.json({ error: 'patient_id and cpt_code required' }, { status: 400 })
  }
  const { data: practice } = await supabaseAdmin
    .from('practices').select('default_fee_schedule_cents').eq('id', auth.practiceId).maybeSingle()
  const fee = body.fee_cents ?? feeForCpt(body.cpt_code, practice?.default_fee_schedule_cents as any)

  const row = {
    practice_id: auth.practiceId,
    patient_id: body.patient_id,
    note_id: body.note_id ?? null,
    appointment_id: body.appointment_id ?? null,
    cpt_code: body.cpt_code,
    units: body.units ?? 1,
    fee_cents: fee,
    allowed_cents: body.allowed_cents ?? fee,
    copay_cents: body.copay_cents ?? 0,
    billed_to: body.billed_to ?? 'insurance',
    status: 'pending' as const,
    service_date: body.service_date ?? new Date().toISOString().slice(0, 10),
    place_of_service: body.place_of_service ?? null,
    created_by: auth.user.id,
  }
  const { data, error } = await supabaseAdmin.from('ehr_charges').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.create',
    resourceId: data.id, details: { kind: 'charge_manual', cpt: row.cpt_code, fee_cents: row.fee_cents },
  })
  return NextResponse.json({ charge: data }, { status: 201 })
}
