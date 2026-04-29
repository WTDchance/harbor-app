// W49 D6 — projected 7-day revenue from booked appointments × CPT
// default rate. Uses a simple per-CPT rate map; refine with real
// payer rates in a follow-up.

import { NextResponse } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RATE_BY_CPT: Record<string, number> = {
  '90791': 200_00,
  '90834': 150_00,
  '90837': 175_00,
  '90847': 175_00,
  '90853': 60_00,
  '99213': 130_00,
}

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT a.id, a.scheduled_for, et.default_cpt_codes
       FROM appointments a
       LEFT JOIN calendar_event_types et ON et.id = a.event_type_id
      WHERE a.practice_id = $1
        AND a.scheduled_for BETWEEN NOW() AND NOW() + INTERVAL '7 days'
        AND COALESCE(a.status, 'scheduled') NOT IN ('cancelled','no_show')`,
    [ctx.practiceId],
  ).catch(() => ({ rows: [] as any[] }))

  let totalCents = 0
  const byDay: Record<string, number> = {}
  for (const r of rows) {
    const day = r.scheduled_for ? new Date(r.scheduled_for).toISOString().slice(0, 10) : 'unknown'
    const codes: string[] = Array.isArray(r.default_cpt_codes) ? r.default_cpt_codes : []
    const cents = codes.reduce((acc, c) => acc + (RATE_BY_CPT[c] ?? 0), 0)
    totalCents += cents
    byDay[day] = (byDay[day] ?? 0) + cents
  }

  return NextResponse.json({
    total_projected_cents: totalCents,
    appointment_count: rows.length,
    by_day: byDay,
  })
}
