// app/api/ehr/reports/caseload/route.ts
// Whole-panel caseload: for every active patient, aggregate:
//   - name
//   - last appointment date (completed)
//   - next upcoming appointment
//   - open (draft) notes count
//   - latest PHQ-9 score + delta from baseline
//   - last mood log
//   - balance owed

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'

export async function GET(_req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth

  const [patients, appts, notes, assessments, moods, charges, payments] = await Promise.all([
    supabaseAdmin.from('patients')
      .select('id, first_name, last_name, phone, email, referral_source, created_at')
      .eq('practice_id', auth.practiceId).limit(1000),
    supabaseAdmin.from('appointments')
      .select('patient_id, appointment_date, status')
      .eq('practice_id', auth.practiceId).limit(5000),
    supabaseAdmin.from('ehr_progress_notes')
      .select('patient_id, status')
      .eq('practice_id', auth.practiceId).limit(5000),
    supabaseAdmin.from('patient_assessments')
      .select('patient_id, assessment_type, score, completed_at, status')
      .eq('practice_id', auth.practiceId).eq('status', 'completed')
      .order('completed_at', { ascending: true }).limit(5000),
    supabaseAdmin.from('ehr_mood_logs')
      .select('patient_id, mood, logged_at')
      .eq('practice_id', auth.practiceId)
      .order('logged_at', { ascending: false }).limit(2000),
    supabaseAdmin.from('ehr_charges')
      .select('patient_id, allowed_cents, status')
      .eq('practice_id', auth.practiceId).limit(5000),
    supabaseAdmin.from('ehr_payments')
      .select('patient_id, amount_cents')
      .eq('practice_id', auth.practiceId).limit(5000),
  ])

  const today = new Date().toISOString().slice(0, 10)

  const lastApptByPt = new Map<string, string>()
  const nextApptByPt = new Map<string, string>()
  for (const a of appts.data ?? []) {
    if (!a.patient_id || !a.appointment_date) continue
    if (a.status === 'completed') {
      const cur = lastApptByPt.get(a.patient_id)
      if (!cur || a.appointment_date > cur) lastApptByPt.set(a.patient_id, a.appointment_date)
    } else if (a.status === 'scheduled' || a.status === 'confirmed') {
      if (a.appointment_date >= today) {
        const cur = nextApptByPt.get(a.patient_id)
        if (!cur || a.appointment_date < cur) nextApptByPt.set(a.patient_id, a.appointment_date)
      }
    }
  }

  const openNotesByPt = new Map<string, number>()
  for (const n of notes.data ?? []) {
    if (n.status === 'draft' && n.patient_id) {
      openNotesByPt.set(n.patient_id, (openNotesByPt.get(n.patient_id) ?? 0) + 1)
    }
  }

  // Track PHQ-9 trajectory — baseline and latest per patient
  const phqBaseline = new Map<string, number>()
  const phqLatest = new Map<string, { score: number; date: string }>()
  for (const a of assessments.data ?? []) {
    if (!a.patient_id || a.score == null) continue
    const t = (a.assessment_type || '').toUpperCase().replace(/-/g, '')
    if (t !== 'PHQ9') continue
    if (!phqBaseline.has(a.patient_id)) phqBaseline.set(a.patient_id, a.score)
    phqLatest.set(a.patient_id, { score: a.score, date: a.completed_at?.slice(0, 10) ?? '' })
  }

  const lastMoodByPt = new Map<string, { mood: number; logged_at: string }>()
  for (const m of moods.data ?? []) {
    if (m.patient_id && !lastMoodByPt.has(m.patient_id)) {
      lastMoodByPt.set(m.patient_id, { mood: m.mood, logged_at: m.logged_at })
    }
  }

  const balanceByPt = new Map<string, number>()
  for (const c of charges.data ?? []) {
    if (c.patient_id && c.status !== 'void' && c.status !== 'written_off') {
      balanceByPt.set(c.patient_id, (balanceByPt.get(c.patient_id) ?? 0) + Number(c.allowed_cents))
    }
  }
  for (const p of payments.data ?? []) {
    if (p.patient_id) {
      balanceByPt.set(p.patient_id, (balanceByPt.get(p.patient_id) ?? 0) - Number(p.amount_cents))
    }
  }

  const rows = (patients.data ?? []).map((p: any) => {
    const phqBase = phqBaseline.get(p.id)
    const phqLast = phqLatest.get(p.id)
    const mood = lastMoodByPt.get(p.id)
    return {
      id: p.id,
      name: [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Patient',
      phone: p.phone,
      email: p.email,
      referral_source: p.referral_source,
      patient_since: p.created_at,
      last_appt: lastApptByPt.get(p.id) ?? null,
      next_appt: nextApptByPt.get(p.id) ?? null,
      open_notes: openNotesByPt.get(p.id) ?? 0,
      phq_latest: phqLast?.score ?? null,
      phq_latest_date: phqLast?.date ?? null,
      phq_delta: phqBase != null && phqLast != null ? phqLast.score - phqBase : null,
      last_mood: mood?.mood ?? null,
      last_mood_date: mood?.logged_at ?? null,
      balance_cents: Math.max(0, balanceByPt.get(p.id) ?? 0),
    }
  })

  return NextResponse.json({ rows })
}
