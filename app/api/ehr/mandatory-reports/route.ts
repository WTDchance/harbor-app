// app/api/ehr/mandatory-reports/route.ts — log or list mandatory reports.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function GET(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')
  let q = supabaseAdmin
    .from('ehr_mandatory_reports')
    .select('id, patient_id, report_type, reported_to, reported_at, incident_date, summary, basis_for_report, follow_up, reference_number, status, created_at')
    .eq('practice_id', auth.practiceId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (patientId) q = q.eq('patient_id', patientId)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ reports: data ?? [] })
}

export async function POST(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const body = await req.json().catch(() => null)
  if (!body?.report_type || !body?.reported_to || !body?.summary) {
    return NextResponse.json({ error: 'report_type, reported_to, summary required' }, { status: 400 })
  }
  const row = {
    practice_id: auth.practiceId,
    patient_id: body.patient_id ?? null,
    report_type: body.report_type,
    reported_to: body.reported_to,
    reported_at: body.reported_at || new Date().toISOString(),
    incident_date: body.incident_date ?? null,
    summary: body.summary,
    basis_for_report: body.basis_for_report ?? null,
    follow_up: body.follow_up ?? null,
    reference_number: body.reference_number ?? null,
    status: body.status || 'submitted',
    reported_by: auth.user.id,
  }
  const { data, error } = await supabaseAdmin.from('ehr_mandatory_reports').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.create',
    resourceId: data.id, details: { kind: 'mandatory_report', type: row.report_type, patient_id: body.patient_id },
    severity: 'warn',
  })
  return NextResponse.json({ report: data }, { status: 201 })
}
