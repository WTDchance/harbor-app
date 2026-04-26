// Who's sending us patients + per-source first-visit conversion.

import { NextResponse } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Bucket = {
  source: string
  patients: number
  had_first_session: number
  active_patients: number // ≥ 1 completed session AND created within last 60 days
}

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ rows: [], total_patients: 0 })

  const [patients, appts] = await Promise.all([
    pool.query(
      `SELECT id, referral_source, created_at
         FROM patients
        WHERE practice_id = $1 LIMIT 2000`,
      [ctx.practiceId],
    ),
    pool.query(
      `SELECT patient_id, status FROM appointments
        WHERE practice_id = $1 LIMIT 5000`,
      [ctx.practiceId],
    ).catch(() => ({ rows: [] as any[] })),
  ])

  const completedByPt = new Map<string, number>()
  for (const a of appts.rows) {
    if (a.status === 'completed' && a.patient_id) {
      completedByPt.set(a.patient_id, (completedByPt.get(a.patient_id) ?? 0) + 1)
    }
  }

  const bySource = new Map<string, Bucket>()
  const sinceCutoff = Date.now() - 60 * 24 * 60 * 60 * 1000
  for (const p of patients.rows) {
    const src = (p.referral_source || 'Unknown').trim() || 'Unknown'
    let b = bySource.get(src)
    if (!b) {
      b = { source: src, patients: 0, had_first_session: 0, active_patients: 0 }
      bySource.set(src, b)
    }
    b.patients++
    const sessions = completedByPt.get(p.id) ?? 0
    if (sessions > 0) b.had_first_session++
    if (sessions > 0 && new Date(p.created_at).getTime() > sinceCutoff) b.active_patients++
  }

  const rows = Array.from(bySource.values())
    .map(b => ({
      ...b,
      conversion_rate: b.patients ? Math.round((b.had_first_session / b.patients) * 100) : 0,
    }))
    .sort((a, b) => b.patients - a.patients)

  return NextResponse.json({ rows, total_patients: patients.rows.length })
}
