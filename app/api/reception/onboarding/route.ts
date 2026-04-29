// app/api/reception/onboarding/route.ts
//
// W51 D5 — read + advance the reception onboarding state.

import { NextResponse, type NextRequest } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STEPS = ['calendar', 'greeting', 'phone', 'test_call'] as const
type Step = typeof STEPS[number]

export async function GET() {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ state: null })

  const r = await pool.query(
    `SELECT step_calendar_done, step_greeting_done, step_phone_done, step_test_call_done, is_live, updated_at
       FROM practice_reception_onboarding WHERE practice_id = $1 LIMIT 1`,
    [ctx.practiceId],
  )
  return NextResponse.json({ state: r.rows[0] ?? null })
}

export async function POST(req: NextRequest) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 400 })

  const body = await req.json().catch(() => null) as { step?: Step; reset?: boolean } | null
  if (!body || (body.step && !STEPS.includes(body.step))) return NextResponse.json({ error: 'invalid_step' }, { status: 400 })

  if (body.reset) {
    await pool.query(`DELETE FROM practice_reception_onboarding WHERE practice_id = $1`, [ctx.practiceId])
    return NextResponse.json({ ok: true, reset: true })
  }
  if (!body.step) return NextResponse.json({ error: 'step_required' }, { status: 400 })

  const col = `step_${body.step}_done`
  await pool.query(
    `INSERT INTO practice_reception_onboarding (practice_id, ${col})
     VALUES ($1, NOW())
     ON CONFLICT (practice_id) DO UPDATE SET ${col} = NOW()`,
    [ctx.practiceId],
  )
  await writeAuditLog({
    practice_id: ctx.practiceId, user_id: ctx.user.id,
    action: 'reception_onboarding.step_completed',
    resource_type: 'practice_reception_onboarding',
    severity: 'info',
    details: { step: body.step },
  })
  const r = await pool.query(
    `SELECT step_calendar_done, step_greeting_done, step_phone_done, step_test_call_done, is_live
       FROM practice_reception_onboarding WHERE practice_id = $1`,
    [ctx.practiceId],
  )
  return NextResponse.json({ state: r.rows[0] })
}
