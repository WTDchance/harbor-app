// app/api/leads/capture/route.ts
//
// Wave 23 (AWS port). Public lead-capture endpoint. Pool upsert.
// Returns the captured row so the marketing site can confirm + dedupe.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { email, source, missed_calls_per_week, estimated_annual_loss } = body
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO leads
            (email, source, missed_calls_per_week, estimated_annual_loss, captured_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (email) DO UPDATE
            SET source = EXCLUDED.source,
                missed_calls_per_week = EXCLUDED.missed_calls_per_week,
                estimated_annual_loss = EXCLUDED.estimated_annual_loss,
                captured_at = EXCLUDED.captured_at
          RETURNING *`,
        [
          String(email).toLowerCase(),
          source || 'unknown',
          missed_calls_per_week || null,
          estimated_annual_loss || null,
        ],
      )
      return NextResponse.json({ ok: true, lead: rows[0] ?? null })
    } catch (err) {
      console.error('[leads/capture]', (err as Error).message)
      return NextResponse.json({ ok: false, error: 'persist_failed' }, { status: 500 })
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 })
  }
}
