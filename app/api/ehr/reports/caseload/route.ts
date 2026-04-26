// Whole-panel caseload — one row per patient with the headline numbers
// the dashboard caseload page wants: last completed appt, next upcoming
// appt, draft note count, latest PHQ-9 + delta from baseline, last mood
// log, balance owed.
//
// Heavy aggregation done in Node (7 parallel SELECTs assembled in-memory).
// Long-term this wants a materialized view; fine to ship as-is for v1.
//
// AWS canonical schema notes:
//   appointments.scheduled_for replaces legacy appointment_date.
//   ehr_payments.received_at falls back to created_at via COALESCE.

import { NextResponse } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ rows: [] })

  const [patients, appts, notes, assessments, moods, charges, payments] = await Promise.all([
    pool.query(
      `SELECT id, first_name, last_name, phone, email, referral_source, created_at
         FROM patients
        WHERE practice_id = $1 LIMIT 1000`,
      [ctx.practiceId],
    ),
    pool.query(
      `SELECT patient_id, scheduled_for, status
         FROM appointments
        WHERE practice_id = $1 LIMIT 5000`,
      [ctx.practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT patient_id, status FROM ehr_progress_notes
        WHERE practice_id = $1 LIMIT 5000`,
      [ctx.practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT patient_id, assessment_type, score, completed_at
         FROM patient_assessments
        WHERE practice_id = $1 AND status = 'completed'
        ORDER BY completed_at ASC LIMIT 5000`,
      [ctx.practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT patient_id, mood, logged_at FROM ehr_mood_logs
        WHERE practice_id = $1
        ORDER BY logged_at DESC LIMIT 2000`,
      [ctx.practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT patient_id, allowed_cents, status FROM ehr_charges
        WHERE practice_id = $1 LIMIT 5000`,
      [ctx.practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT patient_id, amount_cents FROM ehr_payments
        WHERE practice_id = $1 LIMIT 5000`,
      [ctx.practiceId],
    ).catch(() => ({ rows: [] as any[] })),
  ])

  const nowIso = new Date().toISOString()

  const lastApptByPt = new Map<string, string>()
  const nextApptByPt = new Map<string, string>()
  for (const a of appts.rows) {
    if (!a.patient_id || !a.scheduled_for) continue
    const ts = new Date(a.scheduled_for).toISOString()
    if (a.status === 'completed') {
      const cur = lastApptByPt.get(a.patient_id)
      if (!cur || ts > cur) lastApptByPt.set(a.patient_id, ts)
    } else if (a.status === 'scheduled' || a.status === 'confirmed') {
      if (ts >= nowIso) {
        const cur = nextApptByPt.get(a.patient_id)
        if (!cur || ts < cur) nextApptByPt.set(a.patient_id, ts)
      }
    }
  }

  const openNotesByPt = new Map<string, number>()
  for (const n of notes.rows) {
    if (n.status === 'draft' && n.patient_id) {
      openNotesByPt.set(n.patient_id, (openNotesByPt.get(n.patient_id) ?? 0) + 1)
    }
  }

  // PHQ-9 baseline + latest per patient (rows are ASC by completed_at).
  const phqBaseline = new Map<string, number>()
  const phqLatest = new Map<string, { score: number; date: string }>()
  for (const a of assessments.rows) {
    if (!a.patient_id || a.score == null) continue
    const t = (a.assessment_type || '').toUpperCase().replace(/-/g, '')
    if (t !== 'PHQ9') continue
    if (!phqBaseline.has(a.patient_id)) phqBaseline.set(a.patient_id, a.score)
    phqLatest.set(a.patient_id, {
      score: a.score,
      date: a.completed_at ? a.completed_at.toISOString().slice(0, 10) : '',
    })
  }

  const lastMoodByPt = new Map<string, { mood: number; logged_at: string }>()
  for (const m of moods.rows) {
    if (m.patient_id && !lastMoodByPt.has(m.patient_id)) {
      lastMoodByPt.set(m.patient_id, { mood: m.mood, logged_at: m.logged_at })
    }
  }

  const balanceByPt = new Map<string, number>()
  for (const c of charges.rows) {
    if (c.patient_id && c.status !== 'void' && c.status !== 'written_off') {
      balanceByPt.set(
        c.patient_id,
        (balanceByPt.get(c.patient_id) ?? 0) + Number(c.allowed_cents || 0),
      )
    }
  }
  for (const p of payments.rows) {
    if (p.patient_id) {
      balanceByPt.set(
        p.patient_id,
        (balanceByPt.get(p.patient_id) ?? 0) - Number(p.amount_cents || 0),
      )
    }
  }

  const rows = patients.rows.map(p => {
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
