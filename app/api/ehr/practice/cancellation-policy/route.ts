// app/api/ehr/practice/cancellation-policy/route.ts
//
// Wave 42 — Therapist-side read/write for the practice's cancellation
// policy. Decoupled from the larger /api/ehr/practice settings surface
// (Wave 42 second coder) so the schema + backend can ship now and the
// settings UI can wire to this endpoint in their PR.
//
// GET  -> { policy_hours, cancellation_fee_cents, no_show_fee_cents, policy_text }
// PUT  body: same shape (any field omitted is left untouched; pass null to clear)
//
// Setting policy_hours to null disables the policy entirely.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { rows } = await pool.query(
    `SELECT cancellation_policy_hours,
            cancellation_fee_cents,
            no_show_fee_cents,
            cancellation_policy_text
       FROM practices
      WHERE id = $1
      LIMIT 1`,
    [ctx.practiceId],
  )
  const r = rows[0] ?? {}
  return NextResponse.json({
    policy_hours: r.cancellation_policy_hours ?? null,
    cancellation_fee_cents: r.cancellation_fee_cents ?? null,
    no_show_fee_cents: r.no_show_fee_cents ?? null,
    policy_text: r.cancellation_policy_text ?? null,
  })
}

interface PutBody {
  policy_hours?: number | null
  cancellation_fee_cents?: number | null
  no_show_fee_cents?: number | null
  policy_text?: string | null
}

export async function PUT(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const body = (await req.json().catch(() => null)) as PutBody | null
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const sets: string[] = []
  const args: unknown[] = []
  const captured: Record<string, unknown> = {}

  function bind(col: string, key: keyof PutBody) {
    if (!(key in body)) return
    args.push(body[key] ?? null)
    sets.push(`${col} = $${args.length}`)
    captured[key] = body[key] ?? null
  }
  bind('cancellation_policy_hours', 'policy_hours')
  bind('cancellation_fee_cents', 'cancellation_fee_cents')
  bind('no_show_fee_cents', 'no_show_fee_cents')
  bind('cancellation_policy_text', 'policy_text')

  if (sets.length === 0) {
    return NextResponse.json({ error: 'no_fields' }, { status: 400 })
  }

  // Light validation — non-negative integers, hours threshold 0..168 (1 week).
  if (body.policy_hours != null && (!Number.isInteger(body.policy_hours) || body.policy_hours < 0 || body.policy_hours > 168)) {
    return NextResponse.json({ error: 'policy_hours must be a non-negative integer ≤ 168' }, { status: 400 })
  }
  for (const key of ['cancellation_fee_cents', 'no_show_fee_cents'] as const) {
    const v = body[key]
    if (v != null && (!Number.isInteger(v) || v < 0)) {
      return NextResponse.json({ error: `${key} must be a non-negative integer (cents)` }, { status: 400 })
    }
  }

  args.push(ctx.practiceId)
  await pool.query(
    `UPDATE practices SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${args.length}`,
    args,
  )

  await auditEhrAccess({
    ctx,
    action: 'cancellation_policy.configured',
    resourceType: 'practice',
    resourceId: ctx.practiceId ?? null,
    details: captured,
  })

  return NextResponse.json({ ok: true })
}
