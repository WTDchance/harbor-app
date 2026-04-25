// app/api/ehr/reports/referrals/route.ts — who's sending patients + conversion.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'

export async function GET(_req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth

  const [{ data: patients }, { data: appts }] = await Promise.all([
    supabaseAdmin.from('patients')
      .select('id, referral_source, created_at')
      .eq('practice_id', auth.practiceId).limit(2000),
    supabaseAdmin.from('appointments')
      .select('patient_id, status')
      .eq('practice_id', auth.practiceId).limit(5000),
  ])

  const completedByPt = new Map<string, number>()
  for (const a of appts ?? []) {
    if (a.status === 'completed' && a.patient_id) {
      completedByPt.set(a.patient_id, (completedByPt.get(a.patient_id) ?? 0) + 1)
    }
  }

  type Bucket = {
    source: string
    patients: number
    had_first_session: number
    active_patients: number // had a session in last 60 days — simplified: ≥ 1 completed session
  }

  const bySource = new Map<string, Bucket>()
  const sinceCutoff = Date.now() - 60 * 24 * 60 * 60 * 1000
  for (const p of patients ?? []) {
    const src = (p.referral_source || 'Unknown').trim() || 'Unknown'
    let b = bySource.get(src)
    if (!b) { b = { source: src, patients: 0, had_first_session: 0, active_patients: 0 }; bySource.set(src, b) }
    b.patients++
    const sessions = completedByPt.get(p.id) ?? 0
    if (sessions > 0) b.had_first_session++
    if (sessions > 0 && new Date(p.created_at).getTime() > sinceCutoff) b.active_patients++
  }

  const rows = Array.from(bySource.values())
    .map((b) => ({
      ...b,
      conversion_rate: b.patients ? Math.round((b.had_first_session / b.patients) * 100) : 0,
    }))
    .sort((a, b) => b.patients - a.patients)

  return NextResponse.json({ rows, total_patients: patients?.length ?? 0 })
}
