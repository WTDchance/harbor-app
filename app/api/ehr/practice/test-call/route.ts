// app/api/ehr/practice/test-call/route.ts
//
// Wave 42 / T2 — fire an outbound Retell test call so the therapist
// can hear how Ellie sounds with their current prompt + voice settings.
// Body: { to_number: '+1...' }

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { startRetellTestCall } from '@/lib/aws/retell/llm-update'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const toNumber = typeof body?.to_number === 'string' ? body.to_number.trim() : ''
  if (!/^\+\d{10,15}$/.test(toNumber)) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'to_number must be E.164 (e.g. +15555550123)' } },
      { status: 400 },
    )
  }

  const { rows } = await pool.query(
    `SELECT retell_agent_id, signalwire_number, phone_number FROM practices WHERE id = $1 LIMIT 1`,
    [ctx.practiceId],
  )
  const p = rows[0]
  if (!p) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
  if (!p.retell_agent_id) {
    return NextResponse.json(
      { error: { code: 'no_retell_agent', message: 'Practice has no Retell agent provisioned. Contact support.' } },
      { status: 409 },
    )
  }
  const fromNumber = p.signalwire_number || p.phone_number
  if (!fromNumber) {
    return NextResponse.json(
      { error: { code: 'no_practice_number', message: 'Practice has no phone number on file.' } },
      { status: 409 },
    )
  }

  const result = await startRetellTestCall({
    agentId: p.retell_agent_id,
    fromNumber,
    toNumber,
  })

  await auditEhrAccess({
    ctx,
    action: 'practice_settings.test_call_triggered',
    resourceType: 'practice',
    resourceId: ctx.practiceId,
    details: {
      to_number_last_4: toNumber.slice(-4),
      retell_call_id: result.callId ?? null,
      ok: result.ok,
      error: result.ok ? null : result.error,
    },
  })

  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
