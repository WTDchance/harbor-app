// app/api/ehr/practice/ai-prompt/route.ts
//
// Wave 42 / T2 — read + write the per-practice AI receptionist
// prompt override. PUT pushes the new prompt to the practice's
// Retell LLM via update-retell-llm; the DB save is the source of
// truth, the Retell push is best-effort.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { updateRetellLlmPrompt } from '@/lib/aws/retell/llm-update'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT ai_prompt_override, retell_agent_id, retell_llm_id, ai_name
       FROM practices WHERE id = $1 LIMIT 1`,
    [ctx.practiceId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    prompt_override: rows[0].ai_prompt_override ?? null,
    has_retell_llm: !!rows[0].retell_llm_id,
    ai_name: rows[0].ai_name,
  })
}

export async function PUT(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const prompt = typeof body.prompt_override === 'string' && body.prompt_override.trim().length > 0
    ? body.prompt_override
    : null

  // Save to DB first — that's the source of truth.
  await pool.query(
    `UPDATE practices SET ai_prompt_override = $1, updated_at = NOW() WHERE id = $2`,
    [prompt, ctx.practiceId],
  )

  // Best-effort push to Retell.
  let retellPush: { ok: boolean; error?: string } = { ok: false, error: 'no_llm_on_record' }
  if (prompt) {
    const llm = await pool.query(
      `SELECT retell_llm_id FROM practices WHERE id = $1 LIMIT 1`,
      [ctx.practiceId],
    )
    const llmId = llm.rows[0]?.retell_llm_id ?? null
    if (llmId) {
      retellPush = await updateRetellLlmPrompt({ llmId, generalPrompt: prompt })
    }
  }

  await auditEhrAccess({
    ctx,
    action: 'practice_settings.updated',
    resourceType: 'practice',
    resourceId: ctx.practiceId,
    details: {
      kind: 'ai_prompt_override',
      cleared: prompt === null,
      length: prompt?.length ?? 0,
      retell_pushed: retellPush.ok,
      retell_error: retellPush.ok ? null : retellPush.error,
    },
  })

  return NextResponse.json({
    saved: true,
    prompt_override: prompt,
    retell_pushed: retellPush.ok,
    retell_error: retellPush.ok ? null : retellPush.error,
  })
}
