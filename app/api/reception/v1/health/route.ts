// Wave 47 — Reception product split.
//
// GET /api/reception/v1/health
// Returns the practice's product_tier + the scopes attached to the
// caller's API key. Used by third-party EHR integrators to confirm
// their key works and what they can do with it.

import { NextResponse } from 'next/server'
import { withReceptionAuth } from '@/lib/aws/reception/api-handler'
import { pool } from '@/lib/aws/db'

export const dynamic = 'force-dynamic'

export const GET = withReceptionAuth(async (_req, ctx) => {
  const { rows } = await pool.query<{ product_tier: string }>(
    `SELECT product_tier FROM practices WHERE id = $1 LIMIT 1`,
    [ctx.practice_id],
  )
  const tier = rows[0]?.product_tier ?? 'ehr_full'
  return NextResponse.json({
    ok: true,
    practice_id: ctx.practice_id,
    tier,
    scopes: ctx.scopes,
  })
})
