// app/api/ehr/consents/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function GET(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')
  let q = supabaseAdmin
    .from('ehr_consents').select('*')
    .eq('practice_id', auth.practiceId)
    .order('created_at', { ascending: false })
  if (patientId) q = q.eq('patient_id', patientId)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ consents: data })
}

export async function POST(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const body = await req.json().catch(() => null)
  if (!body?.patient_id || !body?.consent_type) {
    return NextResponse.json({ error: 'patient_id and consent_type required' }, { status: 400 })
  }
  const nowIso = new Date().toISOString()
  const row: any = {
    practice_id: auth.practiceId,
    patient_id: body.patient_id,
    consent_type: body.consent_type,
    version: body.version || 'v1',
    document_name: body.document_name ?? null,
    document_url: body.document_url ?? null,
    roi_party_name: body.roi_party_name ?? null,
    roi_party_role: body.roi_party_role ?? null,
    roi_expires_at: body.roi_expires_at ?? null,
    roi_scope: body.roi_scope ?? null,
    status: body.status || 'pending',
    created_by: auth.user.id,
  }
  if (body.sign_now) {
    row.status = 'signed'
    row.signed_at = nowIso
    row.signed_by_name = body.signed_by_name || 'Patient'
    row.signed_method = body.signed_method || 'in_person'
  }
  const { data, error } = await supabaseAdmin.from('ehr_consents').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.create',
    resourceId: data.id, details: { kind: 'consent', consent_type: row.consent_type, signed: !!body.sign_now },
  })
  return NextResponse.json({ consent: data }, { status: 201 })
}
