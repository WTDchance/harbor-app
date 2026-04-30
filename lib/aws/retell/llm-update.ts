// lib/aws/retell/llm-update.ts
//
// Wave 42 / T2 — push a per-practice prompt override to the
// practice's Retell LLM. Best-effort: a Retell API hiccup must
// not block the settings save; we surface the outcome to the
// caller so the UI can show 'saved + pushed' vs 'saved + retry
// pending'.

const RETELL_API_KEY = process.env.RETELL_API_KEY || ''

export interface UpdateLlmResult {
  ok: boolean
  llmId: string | null
  error?: string
}

export async function updateRetellLlmPrompt(args: {
  llmId: string
  generalPrompt: string
}): Promise<UpdateLlmResult> {
  if (!RETELL_API_KEY) {
    return { ok: false, llmId: args.llmId, error: 'RETELL_API_KEY not configured' }
  }
  if (!args.llmId) {
    return { ok: false, llmId: null, error: 'llmId required' }
  }
  try {
    const res = await fetch(`https://api.retellai.com/update-retell-llm/${args.llmId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${RETELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ general_prompt: args.generalPrompt }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, llmId: args.llmId, error: `retell_${res.status}: ${text.slice(0, 200)}` }
    }
    return { ok: true, llmId: args.llmId }
  } catch (err) {
    return { ok: false, llmId: args.llmId, error: (err as Error).message }
  }
}

export async function startRetellTestCall(args: {
  agentId: string
  fromNumber: string
  toNumber: string
}): Promise<{ ok: boolean; callId?: string; error?: string }> {
  if (!RETELL_API_KEY) return { ok: false, error: 'RETELL_API_KEY not configured' }
  if (!args.agentId || !args.fromNumber || !args.toNumber) {
    return { ok: false, error: 'agentId, fromNumber, toNumber required' }
  }
  try {
    const res = await fetch('https://api.retellai.com/v2/create-phone-call', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RETELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from_number: args.fromNumber,
        to_number: args.toNumber,
        override_agent_id: args.agentId,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `retell_${res.status}: ${text.slice(0, 200)}` }
    }
    const j = await res.json().catch(() => ({}))
    return { ok: true, callId: j.call_id ?? j.callId ?? null }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export interface UpdateAgentVoiceResult {
  ok: boolean
  agentId: string | null
  error?: string
}

/**
 * Push a voice_id update to a Retell agent. Best-effort; surfaces
 * errors to the caller so a Retell hiccup doesn't block whatever
 * else the caller is doing.
 */
export async function updateRetellAgentVoice(args: {
  agentId: string
  voiceId: string
}): Promise<UpdateAgentVoiceResult> {
  if (!RETELL_API_KEY) {
    return { ok: false, agentId: args.agentId, error: 'RETELL_API_KEY not configured' }
  }
  if (!args.agentId) return { ok: false, agentId: null, error: 'agentId required' }
  if (!args.voiceId) return { ok: false, agentId: args.agentId, error: 'voiceId required' }
  try {
    const res = await fetch(`https://api.retellai.com/update-agent/${args.agentId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${RETELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ voice_id: args.voiceId }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, agentId: args.agentId, error: `retell_${res.status}: ${text.slice(0, 200)}` }
    }
    return { ok: true, agentId: args.agentId }
  } catch (err) {
    return { ok: false, agentId: args.agentId, error: (err as Error).message }
  }
}

