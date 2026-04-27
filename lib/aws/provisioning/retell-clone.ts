// lib/aws/provisioning/retell-clone.ts
//
// Wave 29 — Clone the Harbor demo Retell agent + LLM into a new
// practice-specific pair. Each new practice gets its own LLM (so the
// system prompt can have practice-specific defaults baked in for
// callers who hit before the inbound webhook fires) and its own agent
// (so voice settings are tunable per-practice).

const RETELL_API_KEY = process.env.RETELL_API_KEY || ''
const DEMO_AGENT_ID = process.env.RETELL_AGENT_ID || ''
const DEMO_LLM_ID = process.env.RETELL_LLM_ID || ''

function authHeader(): string {
  return `Bearer ${RETELL_API_KEY}`
}

async function retellGet<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.retellai.com${path}`, {
    headers: { Authorization: authHeader() },
  })
  if (!res.ok) throw new Error(`retell_${path}_failed_${res.status}: ${await res.text().catch(() => '')}`)
  return res.json()
}

async function retellPost<T>(path: string, body: any): Promise<T> {
  const res = await fetch(`https://api.retellai.com${path}`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`retell_${path}_failed_${res.status}: ${await res.text().catch(() => '')}`)
  return res.json()
}

export interface ClonedRetellPair {
  llmId: string
  agentId: string
}

/**
 * Clone the demo agent + LLM with practice-specific overrides. The
 * resulting LLM has a practice-personalized prompt; the resulting
 * agent inherits all voice + tool config from the demo.
 *
 * Practice-specific tokens substituted into the demo prompt:
 *   {{practice_name}}, {{therapist_name}} — fall back to the per-call
 *   inbound webhook variables, but baked here so callers hear the
 *   right name even if the inbound webhook fails or is slow.
 *
 * We do NOT publish a new "Bella" voice or change voice_id from the
 * demo — the practice can tune that later via the dashboard.
 */
export async function cloneAgentForPractice(opts: {
  practiceName: string
  therapistName?: string
  practiceId: string
}): Promise<ClonedRetellPair> {
  if (!RETELL_API_KEY) throw new Error('RETELL_NOT_CONFIGURED')
  if (!DEMO_AGENT_ID || !DEMO_LLM_ID) throw new Error('RETELL_DEMO_TEMPLATE_NOT_SET')

  // 1. Pull demo LLM
  const demoLlm = await retellGet<any>(`/get-retell-llm/${DEMO_LLM_ID}`)

  // 2. Build practice-specific prompt: substitute the static defaults.
  //    The {{practice_name}} / {{therapist_name}} dynamic placeholders
  //    elsewhere in the prompt remain — Retell still substitutes them
  //    per-call from inbound webhook context.
  const baseGeneralPrompt: string = demoLlm.general_prompt ?? ''
  // Pre-bake fallbacks at the top so callers hit a useful default
  // even when inbound-webhook context is unavailable.
  const therapistLine = opts.therapistName
    ? `If the inbound webhook didn't supply therapist_name, default to "${opts.therapistName}".`
    : 'If the inbound webhook didn\'t supply therapist_name, just say "the therapist."'
  const fallbackHeader = `PRACTICE-SPECIFIC FALLBACKS (used when the inbound webhook context isn't available):
- Practice name: ${opts.practiceName}
- ${therapistLine}

────────────────────────────────────────────────────────────────────

`
  const newGeneralPrompt = fallbackHeader + baseGeneralPrompt

  // 3. Create new LLM
  const llmPayload: any = {
    model: demoLlm.model,
    model_temperature: demoLlm.model_temperature,
    general_prompt: newGeneralPrompt,
    general_tools: demoLlm.general_tools ?? [],
    begin_message: demoLlm.begin_message,
  }
  // Optional fields that may not be present on every demo LLM
  if (demoLlm.knowledge_base_ids) llmPayload.knowledge_base_ids = demoLlm.knowledge_base_ids
  if (demoLlm.tool_call_strict_mode != null) llmPayload.tool_call_strict_mode = demoLlm.tool_call_strict_mode

  const newLlm = await retellPost<any>('/create-retell-llm', llmPayload)
  const newLlmId: string = newLlm.llm_id
  if (!newLlmId) throw new Error('retell_create_llm_returned_no_id')

  // 4. Pull demo agent
  const demoAgent = await retellGet<any>(`/get-agent/${DEMO_AGENT_ID}`)

  // 5. Create new agent pointing at the new LLM
  const agentPayload: any = {
    response_engine: {
      type: 'retell-llm',
      llm_id: newLlmId,
    },
    agent_name: `Harbor — ${opts.practiceName}`,
    voice_id: demoAgent.voice_id,
    voice_temperature: demoAgent.voice_temperature,
    voice_speed: demoAgent.voice_speed,
    ambient_sound: demoAgent.ambient_sound,
    ambient_sound_volume: demoAgent.ambient_sound_volume,
    enable_backchannel: demoAgent.enable_backchannel,
    backchannel_frequency: demoAgent.backchannel_frequency,
    backchannel_words: demoAgent.backchannel_words,
    responsiveness: demoAgent.responsiveness,
    interruption_sensitivity: demoAgent.interruption_sensitivity,
    end_call_after_silence_ms: demoAgent.end_call_after_silence_ms,
    max_call_duration_ms: demoAgent.max_call_duration_ms,
    boosted_keywords: demoAgent.boosted_keywords,
    language: demoAgent.language,
    normalize_for_speech: demoAgent.normalize_for_speech,
    post_call_analysis_data: demoAgent.post_call_analysis_data,
    voicemail_message: demoAgent.voicemail_message,
    opt_out_sensitive_data_storage: demoAgent.opt_out_sensitive_data_storage,
  }

  const newAgent = await retellPost<any>('/create-agent', agentPayload)
  const newAgentId: string = newAgent.agent_id
  if (!newAgentId) throw new Error('retell_create_agent_returned_no_id')

  return { llmId: newLlmId, agentId: newAgentId }
}

/**
 * Import a SignalWire phone number into Retell, binding it to the
 * given agent and pointing the inbound webhook at our app's
 * per-practice context endpoint.
 */
export async function importNumberToRetell(opts: {
  phoneNumber: string  // E.164
  agentId: string
  practiceName: string
  inboundWebhookUrl?: string
}): Promise<{ phoneNumber: string }> {
  if (!RETELL_API_KEY) throw new Error('RETELL_NOT_CONFIGURED')
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://lab.harboroffice.ai'
  const inbound = opts.inboundWebhookUrl || `${APP_URL}/api/retell/inbound-webhook`
  const body: any = {
    phone_number: opts.phoneNumber,
    // SignalWire numbers don't strictly need a termination_uri for
    // inbound-only practices — but the field is required by Retell's
    // API. Use the project's space URL as a placeholder.
    termination_uri: process.env.SIGNALWIRE_SPACE_URL || 'placeholder.invalid',
    inbound_agents: [{ agent_id: opts.agentId, weight: 1.0 }],
    inbound_webhook_url: inbound,
    nickname: opts.practiceName,
  }
  const res = await fetch('https://api.retellai.com/import-phone-number', {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`retell_import_failed_${res.status}: ${await res.text().catch(() => '')}`)
  const json = await res.json() as any
  return { phoneNumber: json.phone_number }
}

/**
 * Delete cloned Retell resources — used for cleanup if provisioning
 * fails midway. Best-effort, no throw on individual delete failures.
 */
export async function rollbackRetellClone(opts: {
  agentId?: string
  llmId?: string
}): Promise<void> {
  if (!RETELL_API_KEY) return
  if (opts.agentId) {
    await fetch(`https://api.retellai.com/delete-agent/${opts.agentId}`, {
      method: 'DELETE', headers: { Authorization: authHeader() },
    }).catch(() => {})
  }
  if (opts.llmId) {
    await fetch(`https://api.retellai.com/delete-retell-llm/${opts.llmId}`, {
      method: 'DELETE', headers: { Authorization: authHeader() },
    }).catch(() => {})
  }
}
