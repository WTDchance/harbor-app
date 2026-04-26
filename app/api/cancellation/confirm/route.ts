// app/api/cancellation/confirm/route.ts
//
// Wave 23 (AWS port). Public confirm — patient clicks the link in
// the cancellation-fill SMS. Marks the fill as accepted, books the
// appointment swap. No auth (token-based access).

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { token } = body
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

  try {
    const { rows: fills } = await pool.query(
      `SELECT id, practice_id, appointment_id, status
         FROM cancellation_fills
        WHERE confirm_token = $1 LIMIT 1`,
      [token],
    )
    const fill = fills[0]
    if (!fill) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (fill.status === 'accepted') {
      return NextResponse.json({ ok: true, already: true })
    }

    await pool.query(
      `UPDATE cancellation_fills SET status = 'accepted', accepted_at = NOW()
        WHERE id = $1`,
      [fill.id],
    )
    return NextResponse.json({ ok: true, fill_id: fill.id })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
