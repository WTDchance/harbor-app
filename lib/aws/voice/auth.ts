// lib/aws/voice/auth.ts
//
// Wave 27c — Shared auth + payload helpers for the per-tool Retell
// route handlers under app/api/voice/tools/*.
//
// Retell POSTs each tool invocation as JSON containing a `call` object
// (with `agent_id`, `call_id`, and `dynamic_variables` we set when we
// registered the call) plus `args` (the tool's arguments per its
// declared schema in the Retell LLM config).
//
// Auth: we accept the request iff `call.agent_id` matches the
// RETELL_AGENT_ID env var. Retell does not (today) sign individual
// tool-call posts the way it signs the call-lifecycle webhook; this
// agent-id gate is the reasonable layer-1 check. Layer-2 protection
// is the URL itself being unguessable + the agent acting only on its
// own behalf.

import { NextRequest, NextResponse } from 'next/server'

export type RetellToolCallPayload = {
  call: {
    call_id?: string
    agent_id?: string
    from_number?: string
    to_number?: string
    direction?: 'inbound' | 'outbound'
    metadata?: Record<string, unknown>
    retell_llm_dynamic_variables?: Record<string, unknown>
  }
  name?: string
  args?: Record<string, unknown>
}

export type ToolContext = {
  callId: string | null
  agentId: string
  practiceId: string | null
  fromNumber: string | null
  toNumber: string | null
  args: Record<string, unknown>
  metadata: Record<string, unknown>
  dynamicVars: Record<string, unknown>
}

/**
 * Parse + auth-check a Retell tool-call POST. Returns either a
 * ToolContext or a NextResponse to short-circuit on with the right
 * status code.
 */
export async function parseRetellToolCall(
  req: NextRequest,
): Promise<ToolContext | NextResponse> {
  const expectedAgentId = process.env.RETELL_AGENT_ID || ''
  if (!expectedAgentId) {
    return NextResponse.json(
      { error: 'retell_agent_not_configured' },
      { status: 500 },
    )
  }

  let body: RetellToolCallPayload
  try {
    body = (await req.json()) as RetellToolCallPayload
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const callerAgentId = body?.call?.agent_id ?? ''
  if (callerAgentId !== expectedAgentId) {
    return NextResponse.json(
      { error: 'forbidden_agent_id' },
      { status: 403 },
    )
  }

  const dynamicVars =
    (body?.call?.retell_llm_dynamic_variables as Record<string, unknown>) ?? {}
  const metadata = (body?.call?.metadata as Record<string, unknown>) ?? {}

  const practiceId =
    typeof dynamicVars.practice_id === 'string'
      ? (dynamicVars.practice_id as string)
      : typeof metadata.practice_id === 'string'
        ? (metadata.practice_id as string)
        : null

  return {
    callId: body?.call?.call_id ?? null,
    agentId: callerAgentId,
    practiceId,
    fromNumber: body?.call?.from_number ?? null,
    toNumber: body?.call?.to_number ?? null,
    args: (body?.args ?? {}) as Record<string, unknown>,
    metadata,
    dynamicVars,
  }
}

/**
 * Standard Retell tool response — Retell expects JSON with a `result`
 * field that the LLM sees as the tool output.
 */
export function toolResult(text: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ result: text, ...extra })
}

/**
 * Normalize a name: trim, lowercase, drop non-letter chars.
 */
export function normalizeName(s: unknown): string {
  if (typeof s !== 'string') return ''
  return s.trim().toLowerCase().replace(/[^a-z]/g, '')
}

/**
 * Normalize a date-of-birth string into YYYY-MM-DD.
 * Accepts spoken forms ("November 7 1990"), slash forms ("11/07/1990"),
 * and ISO ("1990-11-07"). Returns '' on parse failure.
 */
export function normalizeDOB(s: unknown): string {
  if (typeof s !== 'string') return ''
  const trimmed = s.trim()
  if (!trimmed) return ''
  // Try Date.parse on a normalized variant.
  const candidates = [
    trimmed,
    trimmed.replace(/[,]/g, ''),
    trimmed.replace(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/, '$3-$1-$2'),
  ]
  for (const c of candidates) {
    const d = new Date(c)
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10)
    }
  }
  return ''
}
