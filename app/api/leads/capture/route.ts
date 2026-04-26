// app/api/leads/capture/route.ts
//
// Wave 23 (AWS port). Public lead-capture endpoint. Pool upsert.

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
      await pool.query(
        `INSERT INTO leads
            (email, source, missed_calls_per_week, estimated_annual_loss, captured_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (email) DO UPDATE
            SET source = EXCLUDED.source,
                missed_calls_per_week = EXCLUDED.missed_calls_per_week,
                estimated_annual_loss = EXCLUDED.estimated_annual_loss,
                captured_at = EXCLUDED.captured_at`,
        [
          String(email).toLowerCase(),
          source || 'unknown',
          missed_calls_per_week || null,
          estimated_annual_loss || null,
        ],
      )
    } catch (err) {
      console.error('[leads/capture]', (err as Error).message)
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true })
  }
}
