// app/api/ehr/practice/sliding-fee/route.ts
//
// Wave 41 / T6 — read + write the practice's sliding-fee config.
//
// GET  → { enabled, config: [...] }
// PUT  → { enabled, config: [...] }   (validateSlidingFeeConfig — 400 on shape error)

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { validateSlidingFeeConfig } from '@/lib/aws/billing/sliding-fee'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT sliding_fee_enabled, sliding_fee_config
       FROM practices WHERE id = $1 LIMIT 1`,
    [ctx.practiceId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    enabled: !!rows[0].sliding_fee_enabled,
    config: Array.isArray(rows[0].sliding_fee_config) ? rows[0].sliding_fee_config : [],
  })
}

export async function PUT(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const enabled = body.enabled === true
  let config: any[] = []
  try {
    config = validateSlidingFeeConfig(body.config ?? [])
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: (err as Error).message,
        },
      },
      { status: 400 },
    )
  }

  await pool.query(
    `UPDATE practices
        SET sliding_fee_enabled = $1,
            sliding_fee_config  = $2::jsonb,
            updated_at          = NOW()
      WHERE id = $3`,
    [enabled, JSON.stringify(config), ctx.practiceId],
  )

  await auditEhrAccess({
    ctx,
    action: 'practice.sliding_fee.configured',
    resourceType: 'practice',
    resourceId: ctx.practiceId,
    details: {
      enabled,
      tier_count: config.length,
      tier_names: config.map((t: any) => t.name),
    },
  })

  return NextResponse.json({ enabled, config })
}
