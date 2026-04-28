// Wave 47 — Reception product split.
//
// /api/reception/v1/agents
//   GET  — fetch the practice's Retell agent config (agents:read scope)
//   POST — update the system prompt on the practice's Retell LLM
//          (agents:write scope). Body: { system_prompt: string }
//
// The Retell agent_id and llm_id live on the practices row; we proxy to
// the Retell HTTP API. Errors from upstream are returned as 502.

import { NextResponse } from 'next/server'
import { withReceptionAuth, requireScope } from '@/lib/aws/reception/api-handler'
import { pool } from '@/lib/aws/db'
import { updateRetellLlmPrompt } from '@/lib/aws/retell/llm-update'

export const dynamic = 'force-dynamic'

const RETELL_API_KEY = process.env.RETELL_API_KEY || ''

async function loadRetellIds(practice_id: string): Promise<{
  retell_agent_id: string | null
  retell_llm_id: string | null
}> {
  const { rows } = await pool.query<{
    retell_agent_id: string | null
    retell_llm_id: string | null
  }>(
    `SELECT retell_agent_id, retell_llm_id FROM practices WHERE id = $1 LIMIT 1`,
    [practice_id],
  )
  return rows[0] ?? { retell_agent_id: null, retell_llm_id: null }
}

export const GET = withReceptionAuth(async (_req, ctx) => {
  const denied = requireScope(ctx, 'agents:read')
  if (denied) return denied

  const ids = await loadRetellIds(ctx.practice_id)
  if (!ids.retell_agent_id) {
    return NextResponse.json(
      { error: 'no_agent', message: 'Practice has no Retell agent provisioned yet.' },
      { status: 404 },
    )
  }
  if (!RETELL_API_KEY) {
    return NextResponse.json({ error: 'retell_not_configured' }, { status: 500 })
  }

  try {
    const res = await fetch(`https://api.retellai.com/get-agent/${ids.retell_agent_id}`, {
      headers: { Authorization: `Bearer ${RETELL_API_KEY}` },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json(
        { error: 'retell_upstream', status: res.status, detail: text.slice(0, 500) },
        { status: 502 },
      )
    }
    const agent = await res.json()
    return NextResponse.json({
      practice_id: ctx.practice_id,
      agent_id: ids.retell_agent_id,
      llm_id: ids.retell_llm_id,
      agent,
    })
  } catch (err) {
    return NextResponse.json(
      { error: 'retell_fetch_failed', detail: (err as Error).message },
      { status: 502 },
    )
  }
})

export const POST = withReceptionAuth(async (req, ctx) => {
  const denied = requireScope(ctx, 'agents:write')
  if (denied) return denied

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const system_prompt = typeof body?.system_prompt === 'string' ? body.system_prompt : null
  if (!system_prompt || system_prompt.trim().length === 0) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'system_prompt (string) is required' },
      { status: 400 },
    )
  }

  const ids = await loadRetellIds(ctx.practice_id)
  if (!ids.retell_llm_id) {
    return NextResponse.json(
      { error: 'no_llm', message: 'Practice has no Retell LLM provisioned yet.' },
      { status: 404 },
    )
  }

  const result = await updateRetellLlmPrompt({
    llmId: ids.retell_llm_id,
    generalPrompt: system_prompt,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: 'retell_update_failed', detail: result.error },
      { status: 502 },
    )
  }
  return NextResponse.json({ ok: true, llm_id: result.llmId })
})
