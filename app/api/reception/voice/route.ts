// app/api/reception/voice/route.ts
//
// W51 D7 — read + write the per-practice greeting + voice. Tier-friendly
// (reception_only practices use this; ehr-only practices keep the existing
// /api/ehr/practice/ai-prompt route).

import { NextResponse, type NextRequest } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'
import { updateRetellLlmPrompt } from '@/lib/aws/retell/llm-update'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const VOICE_OPTIONS = [
  { id: 'eleven-labs-rachel',  name: 'Rachel — calm, warm female (default)' },
  { id: 'eleven-labs-bella',   name: 'Bella — bright, friendly female' },
  { id: 'eleven-labs-adam',    name: 'Adam — steady, low male' },
  { id: 'eleven-labs-antoni',  name: 'Antoni — warm, expressive male' },
  { id: 'play-ht-jennifer',    name: 'Jennifer — natural conversational female' },
] as const

export async function GET() {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 400 })

  const { rows } = await pool.query(
    `SELECT ai_prompt_override, ai_voice_id, ai_name, retell_llm_id
       FROM practices WHERE id = $1 LIMIT 1`,
    [ctx.practiceId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({
    prompt_override: rows[0].ai_prompt_override ?? null,
    voice_id: rows[0].ai_voice_id ?? null,
    ai_name: rows[0].ai_name,
    has_retell_llm: !!rows[0].retell_llm_id,
    voice_options: VOICE_OPTIONS,
  })
}

export async function PUT(req: NextRequest) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 400 })

  const body = await req.json().catch(() => null) as { prompt_override?: string | null; voice_id?: string | null } | null
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const sets: string[] = []
  const args: any[] = []

  if (body.prompt_override !== undefined) {
    const prompt = typeof body.prompt_override === 'string' && body.prompt_override.trim().length > 0
      ? body.prompt_override.slice(0, 20000)
      : null
    args.push(prompt); sets.push(`ai_prompt_override = $${args.length}`)
  }
  if (body.voice_id !== undefined) {
    const v = typeof body.voice_id === 'string' && body.voice_id.trim().length > 0 ? body.voice_id.trim().slice(0, 100) : null
    if (v && !VOICE_OPTIONS.some(o => o.id === v)) {
      return NextResponse.json({ error: 'invalid_voice_id' }, { status: 400 })
    }
    args.push(v); sets.push(`ai_voice_id = $${args.length}`)
  }
  if (sets.length === 0) return NextResponse.json({ error: 'no_changes' }, { status: 400 })

  args.push(ctx.practiceId)
  await pool.query(
    `UPDATE practices SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${args.length}`,
    args,
  )

  // Best-effort push to Retell.
  let retell_pushed = false
  try {
    const { rows: rr } = await pool.query(
      `SELECT retell_llm_id, ai_prompt_override FROM practices WHERE id = $1 LIMIT 1`,
      [ctx.practiceId],
    )
    if (rr[0]?.retell_llm_id && rr[0]?.ai_prompt_override) {
      await updateRetellLlmPrompt(rr[0].retell_llm_id, rr[0].ai_prompt_override)
      retell_pushed = true
    }
  } catch (e) {
    console.error('[reception/voice] retell push failed:', (e as Error).message)
  }

  await writeAuditLog({
    practice_id: ctx.practiceId, user_id: ctx.user.id,
    action: 'reception_voice.updated', resource_type: 'practice',
    severity: 'info',
    details: {
      prompt_set: body.prompt_override !== undefined,
      voice_set: body.voice_id !== undefined,
      retell_pushed,
    },
  })

  return NextResponse.json({ ok: true, retell_pushed })
}
