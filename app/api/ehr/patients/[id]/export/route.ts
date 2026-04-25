// app/api/ehr/patients/[id]/export/route.ts
// Patient record export — HIPAA right-of-access. Returns everything we
// have on one patient in a single JSON blob. Format=html renders a
// printable HTML document the patient can save as PDF from the browser.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id: patientId } = await params
  const { searchParams } = new URL(req.url)
  const format = searchParams.get('format') || 'json'

  const { data: patient } = await supabaseAdmin
    .from('patients').select('*').eq('id', patientId).eq('practice_id', auth.practiceId).maybeSingle()
  if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

  const [appts, notes, plans, safety, assessments, consents, calls] = await Promise.all([
    supabaseAdmin.from('appointments').select('*').eq('practice_id', auth.practiceId).eq('patient_id', patientId).order('appointment_date', { ascending: false }),
    supabaseAdmin.from('ehr_progress_notes').select('*').eq('practice_id', auth.practiceId).eq('patient_id', patientId).order('created_at', { ascending: false }),
    supabaseAdmin.from('ehr_treatment_plans').select('*').eq('practice_id', auth.practiceId).eq('patient_id', patientId).order('created_at', { ascending: false }),
    supabaseAdmin.from('ehr_safety_plans').select('*').eq('practice_id', auth.practiceId).eq('patient_id', patientId).order('created_at', { ascending: false }),
    supabaseAdmin.from('patient_assessments').select('*').eq('practice_id', auth.practiceId).eq('patient_id', patientId).order('completed_at', { ascending: false }),
    supabaseAdmin.from('ehr_consents').select('*').eq('practice_id', auth.practiceId).eq('patient_id', patientId).order('created_at', { ascending: false }),
    supabaseAdmin.from('call_logs').select('id, created_at, duration_seconds, call_type, summary').eq('practice_id', auth.practiceId).eq('patient_id', patientId).order('created_at', { ascending: false }),
  ])

  const record = {
    exported_at: new Date().toISOString(),
    practice_id: auth.practiceId,
    patient,
    appointments: appts.data ?? [],
    progress_notes: notes.data ?? [],
    treatment_plans: plans.data ?? [],
    safety_plans: safety.data ?? [],
    assessments: assessments.data ?? [],
    consents: consents.data ?? [],
    calls: calls.data ?? [],
  }

  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.view',
    resourceId: patientId,
    details: {
      kind: 'full_record_export',
      format,
      counts: {
        appointments: record.appointments.length,
        progress_notes: record.progress_notes.length,
        treatment_plans: record.treatment_plans.length,
        safety_plans: record.safety_plans.length,
        assessments: record.assessments.length,
        consents: record.consents.length,
        calls: record.calls.length,
      },
    },
  })

  if (format === 'html') {
    return new NextResponse(renderHtml(record), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  return new NextResponse(JSON.stringify(record, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="patient-${patientId}-${Date.now()}.json"`,
    },
  })
}

function esc(s: any): string {
  if (s == null) return ''
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function renderHtml(r: any): string {
  const p = r.patient
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ')
  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>Patient record — ${esc(name)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; max-width: 760px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.1rem; margin-top: 2rem; border-bottom: 1px solid #ccc; padding-bottom: 0.25rem; }
  h3 { font-size: 0.95rem; margin-top: 1rem; color: #0d9488; }
  .meta { color: #6b7280; font-size: 0.85rem; }
  .section { margin-top: 1rem; }
  .kv { display: grid; grid-template-columns: 180px 1fr; gap: 0.25rem 1rem; font-size: 0.9rem; }
  .kv > div:nth-child(odd) { color: #6b7280; }
  .note { border: 1px solid #e5e7eb; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 0.75rem; page-break-inside: avoid; }
  .note .title { font-weight: 600; }
  .note .status { font-size: 0.7rem; text-transform: uppercase; color: #6b7280; margin-left: 0.5rem; }
  pre { white-space: pre-wrap; font-family: inherit; font-size: 0.88rem; margin: 0.25rem 0; }
  .footer { margin-top: 3rem; font-size: 0.75rem; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 0.5rem; }
  @media print { body { margin: 0; } h1 { font-size: 1.5rem; } .note { border-color: #999; } }
</style></head><body>
<h1>${esc(name)}</h1>
<div class="meta">Patient record · Exported ${esc(new Date(r.exported_at).toLocaleString())}</div>

<h2>Patient Information</h2>
<div class="kv">
  <div>Phone</div><div>${esc(p.phone ?? '')}</div>
  <div>Email</div><div>${esc(p.email ?? '')}</div>
  <div>Date of birth</div><div>${esc(p.date_of_birth ?? '')}</div>
  <div>Insurance</div><div>${esc(p.insurance ?? '')}</div>
  <div>Reason for seeking care</div><div>${esc(p.reason_for_seeking ?? '')}</div>
</div>

<h2>Treatment Plans (${r.treatment_plans.length})</h2>
${r.treatment_plans.map((tp: any) => `
  <div class="note">
    <div><span class="title">${esc(tp.title)}</span><span class="status">${esc(tp.status)}</span></div>
    ${tp.presenting_problem ? `<div><strong>Presenting problem:</strong> <pre>${esc(tp.presenting_problem)}</pre></div>` : ''}
    ${(tp.diagnoses && tp.diagnoses.length) ? `<div><strong>Diagnoses:</strong> ${esc(tp.diagnoses.join(', '))}</div>` : ''}
    ${(tp.goals && tp.goals.length) ? `<div><strong>Goals:</strong><ul>${tp.goals.map((g: any) => `<li>${esc(g.text)}</li>`).join('')}</ul></div>` : ''}
    <div class="meta">Start ${esc(tp.start_date ?? '')} · Review ${esc(tp.review_date ?? '')}</div>
  </div>
`).join('')}

<h2>Safety Plans (${r.safety_plans.length})</h2>
${r.safety_plans.map((sp: any) => `
  <div class="note">
    <div class="title">Stanley-Brown safety plan <span class="status">${esc(sp.status)}</span></div>
    ${(sp.warning_signs && sp.warning_signs.length) ? `<div><strong>Warning signs:</strong> ${esc(sp.warning_signs.join('; '))}</div>` : ''}
    ${(sp.internal_coping && sp.internal_coping.length) ? `<div><strong>Coping strategies:</strong> ${esc(sp.internal_coping.join('; '))}</div>` : ''}
    ${(sp.reasons_for_living && sp.reasons_for_living.length) ? `<div><strong>Reasons for living:</strong> ${esc(sp.reasons_for_living.join('; '))}</div>` : ''}
    ${sp.means_restriction ? `<div><strong>Means restriction:</strong> ${esc(sp.means_restriction)}</div>` : ''}
  </div>
`).join('')}

<h2>Progress Notes (${r.progress_notes.length})</h2>
${r.progress_notes.map((n: any) => `
  <div class="note">
    <div><span class="title">${esc(n.title)}</span><span class="status">${esc(n.status)} · ${esc(n.note_format)}</span></div>
    <div class="meta">${esc(new Date(n.created_at).toLocaleString())}${n.signed_at ? ` · Signed ${esc(new Date(n.signed_at).toLocaleString())}` : ''}</div>
    ${n.subjective ? `<h3>Subjective</h3><pre>${esc(n.subjective)}</pre>` : ''}
    ${n.objective  ? `<h3>Objective</h3><pre>${esc(n.objective)}</pre>` : ''}
    ${n.assessment ? `<h3>Assessment</h3><pre>${esc(n.assessment)}</pre>` : ''}
    ${n.plan       ? `<h3>Plan</h3><pre>${esc(n.plan)}</pre>` : ''}
    ${n.body       ? `<h3>Note</h3><pre>${esc(n.body)}</pre>` : ''}
    ${(n.cpt_codes && n.cpt_codes.length) ? `<div class="meta">CPT: ${esc(n.cpt_codes.join(', '))}</div>` : ''}
    ${(n.icd10_codes && n.icd10_codes.length) ? `<div class="meta">ICD-10: ${esc(n.icd10_codes.join(', '))}</div>` : ''}
  </div>
`).join('')}

<h2>Assessments (${r.assessments.length})</h2>
${r.assessments.map((a: any) => `
  <div class="note">
    <div><span class="title">${esc(a.assessment_type)}: ${esc(a.score)}</span><span class="status">${esc(a.severity ?? '')}</span></div>
    <div class="meta">${esc(a.completed_at ? new Date(a.completed_at).toLocaleDateString() : new Date(a.created_at).toLocaleDateString())}</div>
    ${a.notes ? `<pre>${esc(a.notes)}</pre>` : ''}
  </div>
`).join('')}

<h2>Appointments (${r.appointments.length})</h2>
<ul>${r.appointments.map((ap: any) => `
  <li>${esc(ap.appointment_date ?? '')} ${esc((ap.appointment_time ?? '').slice(0,5))} · ${esc(ap.appointment_type ?? '')} · <em>${esc(ap.status)}</em></li>
`).join('')}</ul>

<h2>Consents (${r.consents.length})</h2>
<ul>${r.consents.map((c: any) => `
  <li>${esc(c.consent_type)} — ${esc(c.status)}${c.signed_at ? ` · signed ${esc(new Date(c.signed_at).toLocaleDateString())}` : ''}</li>
`).join('')}</ul>

<h2>Call Contacts (${r.calls.length})</h2>
<ul>${r.calls.map((c: any) => `
  <li>${esc(new Date(c.created_at).toLocaleString())} · ${esc(c.call_type ?? '')} · ${esc(c.duration_seconds ?? 0)}s — ${esc(c.summary ?? '')}</li>
`).join('')}</ul>

<div class="footer">
  Generated by Harbor EHR · ${esc(new Date(r.exported_at).toISOString())}<br>
  This document contains protected health information. Handle under HIPAA.
</div>
</body></html>`
}
