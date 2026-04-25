// app/api/cron/ehr-schedule-tick/route.ts
// Cron endpoint: run this every ~15 minutes via cron-job.org (Harbor's
// existing pattern). It finds active schedules whose next_due_at has
// passed, creates a pending patient_assessments row for each, and bumps
// next_due_at by cadence_weeks.
//
// Auth: Bearer CRON_SECRET, same pattern as Harbor's other cron endpoints.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getInstrument } from '@/lib/ehr/instruments'

const WINDOW_DAYS = 14

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const nowIso = new Date().toISOString()
  const { data: due, error } = await supabaseAdmin
    .from('ehr_assessment_schedules')
    .select('id, practice_id, patient_id, assessment_type, cadence_weeks, next_due_at')
    .eq('is_active', true)
    .lte('next_due_at', nowIso)
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results: Array<{ schedule_id: string; status: 'created' | 'skipped'; reason?: string }> = []

  for (const s of due ?? []) {
    const inst = getInstrument(s.assessment_type)
    if (!inst) { results.push({ schedule_id: s.id, status: 'skipped', reason: 'unknown instrument' }); continue }

    // Skip if a pending row for this patient+type already exists
    const { data: existingPending } = await supabaseAdmin
      .from('patient_assessments')
      .select('id')
      .eq('patient_id', s.patient_id)
      .eq('assessment_type', s.assessment_type)
      .eq('status', 'pending')
      .maybeSingle()
    if (existingPending?.id) {
      // bump next_due_at anyway so we don't re-tick endlessly
      await supabaseAdmin.from('ehr_assessment_schedules')
        .update({ next_due_at: new Date(Date.now() + s.cadence_weeks * 7 * 24 * 60 * 60 * 1000).toISOString() })
        .eq('id', s.id)
      results.push({ schedule_id: s.id, status: 'skipped', reason: 'pending exists' })
      continue
    }

    // Create the pending assessment
    const expires = new Date(Date.now() + WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const { data: patient } = await supabaseAdmin
      .from('patients').select('first_name, last_name').eq('id', s.patient_id).maybeSingle()
    await supabaseAdmin.from('patient_assessments').insert({
      practice_id: s.practice_id,
      patient_id: s.patient_id,
      patient_name: patient ? `${patient.first_name} ${patient.last_name}`.trim() : null,
      assessment_type: inst.id,
      status: 'pending',
      administered_via: 'portal',
      assigned_at: nowIso,
      expires_at: expires.toISOString(),
    })

    await supabaseAdmin.from('ehr_assessment_schedules')
      .update({ next_due_at: new Date(Date.now() + s.cadence_weeks * 7 * 24 * 60 * 60 * 1000).toISOString() })
      .eq('id', s.id)

    results.push({ schedule_id: s.id, status: 'created' })
  }

  return NextResponse.json({
    checked: (due ?? []).length,
    created: results.filter((r) => r.status === 'created').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    results,
  })
}
