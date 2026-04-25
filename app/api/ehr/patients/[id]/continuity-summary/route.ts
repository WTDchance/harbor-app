// app/api/ehr/patients/[id]/continuity-summary/route.ts
// One-page referral summary the therapist can send to a PCP, psychiatrist,
// or successor provider. Narrower than the full export — intended to
// communicate the essential clinical picture without dumping every note.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id: patientId } = await params

  const { data: patient } = await supabaseAdmin
    .from('patients').select('*').eq('id', patientId).eq('practice_id', auth.practiceId).maybeSingle()
  if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

  const [practice, plan, latestAssess, latestNote, safety, recentAppts] = await Promise.all([
    supabaseAdmin.from('practices').select('name, phone_number, location').eq('id', auth.practiceId).maybeSingle(),
    supabaseAdmin.from('ehr_treatment_plans').select('*').eq('practice_id', auth.practiceId).eq('patient_id', patientId).eq('status', 'active').maybeSingle(),
    supabaseAdmin.from('patient_assessments').select('assessment_type, score, severity, completed_at')
      .eq('practice_id', auth.practiceId).eq('patient_id', patientId).eq('status', 'completed')
      .order('completed_at', { ascending: false }).limit(5),
    supabaseAdmin.from('ehr_progress_notes').select('title, assessment, plan, created_at, signed_at')
      .eq('practice_id', auth.practiceId).eq('patient_id', patientId).in('status', ['signed', 'amended'])
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('ehr_safety_plans').select('status').eq('practice_id', auth.practiceId).eq('patient_id', patientId).eq('status', 'active').maybeSingle(),
    supabaseAdmin.from('appointments').select('appointment_date, appointment_type, status')
      .eq('practice_id', auth.practiceId).eq('patient_id', patientId)
      .order('appointment_date', { ascending: false }).limit(5),
  ])

  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.view',
    resourceId: patientId,
    details: { kind: 'continuity_summary_export' },
  })

  const html = render({
    patient, practice: practice.data, plan: plan.data,
    assessments: latestAssess.data || [],
    latestNote: latestNote.data,
    hasActiveSafetyPlan: !!safety.data,
    appointments: recentAppts.data || [],
  })

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

function esc(s: any): string {
  if (s == null) return ''
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function render(d: any): string {
  const p = d.patient
  const prac = d.practice ?? {}
  const plan = d.plan
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ')
  const today = new Date().toLocaleDateString()

  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>Continuity of Care — ${esc(name)}</title>
<style>
  @page { margin: 0.75in; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; line-height: 1.45; max-width: 720px; margin: 1.5rem auto; padding: 0 1.25rem; }
  h1 { font-size: 1.45rem; margin: 0 0 0.2rem; }
  h2 { font-size: 1rem; margin-top: 1.25rem; border-bottom: 1px solid #bbb; padding-bottom: 0.15rem; }
  .meta { color: #555; font-size: 0.85rem; }
  .kv { display: grid; grid-template-columns: 160px 1fr; gap: 0.2rem 0.8rem; font-size: 0.9rem; }
  .kv > div:nth-child(odd) { color: #666; }
  ul { padding-left: 1.25rem; margin: 0.25rem 0; }
  .flag { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 0.25rem; background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; font-size: 0.8rem; font-weight: 600; }
  .footer { margin-top: 2rem; font-size: 0.75rem; color: #666; border-top: 1px solid #e5e7eb; padding-top: 0.5rem; }
  @media print { body { margin: 0 auto; } }
</style></head><body>
<div class="meta">${esc(prac.name ?? '')}${prac.phone_number ? ' · ' + esc(prac.phone_number) : ''}${prac.location ? ' · ' + esc(prac.location) : ''}</div>
<h1>Continuity of Care Summary</h1>
<div class="meta">Generated ${esc(today)}</div>

<h2>Patient</h2>
<div class="kv">
  <div>Name</div><div>${esc(name)}</div>
  <div>Phone</div><div>${esc(p.phone ?? '')}</div>
  <div>Email</div><div>${esc(p.email ?? '')}</div>
  <div>Date of birth</div><div>${esc(p.date_of_birth ?? '')}</div>
  <div>Insurance</div><div>${esc(p.insurance ?? '')}</div>
</div>

<h2>Reason for treatment</h2>
<p>${esc(p.reason_for_seeking ?? plan?.presenting_problem ?? 'Not specified.')}</p>

${plan ? `
<h2>Active treatment plan</h2>
<div class="kv">
  <div>Plan title</div><div>${esc(plan.title ?? '')}</div>
  ${plan.diagnoses?.length ? `<div>Working diagnoses</div><div>${esc(plan.diagnoses.join(', '))}</div>` : ''}
  ${plan.frequency ? `<div>Frequency</div><div>${esc(plan.frequency)}</div>` : ''}
  ${plan.start_date ? `<div>Start date</div><div>${esc(plan.start_date)}</div>` : ''}
</div>
${plan.goals?.length ? `<p><strong>Goals:</strong></p><ul>${plan.goals.map((g: any) => `<li>${esc(g.text)}</li>`).join('')}</ul>` : ''}
` : '<h2>Active treatment plan</h2><p>No active plan on file.</p>'}

${d.hasActiveSafetyPlan ? `<h2>Safety planning</h2><p><span class="flag">Active Stanley-Brown safety plan on file.</span> Available on request.</p>` : ''}

${d.assessments?.length ? `
<h2>Recent assessment scores</h2>
<ul>
  ${d.assessments.map((a: any) => `<li>${esc(a.assessment_type)} — <strong>${esc(a.score)}</strong> (${esc(a.severity ?? '')}) on ${esc(a.completed_at ? new Date(a.completed_at).toLocaleDateString() : '')}</li>`).join('')}
</ul>` : ''}

${d.latestNote ? `
<h2>Most recent clinical impression</h2>
<p><em>${esc(d.latestNote.title)} · ${esc(new Date(d.latestNote.created_at).toLocaleDateString())}</em></p>
${d.latestNote.assessment ? `<p><strong>Assessment:</strong> ${esc(d.latestNote.assessment)}</p>` : ''}
${d.latestNote.plan ? `<p><strong>Plan:</strong> ${esc(d.latestNote.plan)}</p>` : ''}
` : ''}

${d.appointments?.length ? `
<h2>Recent appointments</h2>
<ul>
  ${d.appointments.map((ap: any) => `<li>${esc(ap.appointment_date)} — ${esc(ap.appointment_type ?? '')} (${esc(ap.status)})</li>`).join('')}
</ul>` : ''}

<div class="footer">
  Summary prepared by ${esc(prac.name ?? 'the practice')} for continuity of care. Contains protected health information. Handle under HIPAA.
</div>
</body></html>`
}
