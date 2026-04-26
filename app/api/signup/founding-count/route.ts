// app/api/signup/founding-count/route.ts
//
// Wave 23 (AWS port). Public — landing-page banner + signup wizard
// reads founding-member availability from RDS.

import { NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'

const FOUNDING_CAP = Number(process.env.FOUNDING_MEMBER_CAP || '20')
const FOUNDING_PRICE_CENTS = 39700
const REGULAR_PRICE_CENTS = 59700

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM practices
        WHERE founding_member = TRUE
          AND provisioning_state IN ('active','provisioning')`,
    )
    const used = rows[0]?.c ?? 0
    const remaining = Math.max(0, FOUNDING_CAP - used)
    const isAvailable = remaining > 0
    return NextResponse.json({
      used,
      cap: FOUNDING_CAP,
      remaining,
      is_founding_available: isAvailable,
      price_cents: isAvailable ? FOUNDING_PRICE_CENTS : REGULAR_PRICE_CENTS,
      regular_price_cents: REGULAR_PRICE_CENTS,
    })
  } catch (err) {
    console.error('[founding-count]', (err as Error).message)
    return NextResponse.json({
      used: 0,
      cap: FOUNDING_CAP,
      remaining: FOUNDING_CAP,
      is_founding_available: true,
      price_cents: FOUNDING_PRICE_CENTS,
      regular_price_cents: REGULAR_PRICE_CENTS,
    })
  }
}
