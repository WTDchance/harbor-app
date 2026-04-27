// lib/observability/structured-log.ts
//
// Tier-1 / T1.4 — minimal JSON-line logger. CloudWatch / Container Insights
// auto-parses single-line JSON, so writing one object per event makes alarm
// queries (Logs Insights / metric filters) tractable without dragging in
// pino/winston.
//
// Conventions:
//   - "event" is a stable dot.path string, e.g. webhook.signature_pass.
//   - "actor_*" + "target_*" identify principals/resources (no PHI).
//   - Free-form context goes in "ctx"; PII/PHI must NOT be put here.
//   - Latency / duration uses milliseconds, integer.
//
// Why not just console.log a string?
//   The existing prefix-style console logs ("[stripe/webhook] foo") are fine
//   for grep but useless for metric filters. JSON unlocks both.

type Severity = 'debug' | 'info' | 'warn' | 'error'

export interface StructuredEvent {
  event: string
  severity?: Severity
  actor_user_id?: string | null
  actor_email?: string | null
  actor_practice_id?: string | null
  target_id?: string | null
  target_kind?: string | null
  duration_ms?: number
  status_code?: number
  ok?: boolean
  ctx?: Record<string, unknown>
}

const REDACT = new Set(['password', 'authorization', 'cookie', 'token', 'api_key', 'apiKey'])

function redact(obj: unknown, depth = 0): unknown {
  if (depth > 4 || obj == null) return obj
  if (typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map((x) => redact(x, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACT.has(k.toLowerCase())) out[k] = '[redacted]'
    else out[k] = redact(v, depth + 1)
  }
  return out
}

export function logEvent(e: StructuredEvent): void {
  const line = {
    t: new Date().toISOString(),
    sev: e.severity ?? 'info',
    event: e.event,
    actor_user_id: e.actor_user_id ?? null,
    actor_email: e.actor_email ?? null,
    actor_practice_id: e.actor_practice_id ?? null,
    target_id: e.target_id ?? null,
    target_kind: e.target_kind ?? null,
    duration_ms: e.duration_ms,
    status_code: e.status_code,
    ok: e.ok,
    ctx: e.ctx ? (redact(e.ctx) as Record<string, unknown>) : undefined,
  }
  // Single line, JSON. CloudWatch picks it up directly.
  // (Do NOT JSON.stringify -> console.log a multi-line string; metric
  //  filters in CloudWatch only match single-line patterns.)
  process.stdout.write(JSON.stringify(line) + '\n')
}

/** Sugar for webhook signature outcomes. */
export function logWebhookSignature(
  source: 'stripe' | 'signalwire' | 'retell',
  ok: boolean,
  ctx?: Record<string, unknown>,
): void {
  logEvent({
    event: ok ? `webhook.${source}.signature_pass` : `webhook.${source}.signature_fail`,
    severity: ok ? 'info' : 'warn',
    ok,
    ctx,
  })
}

/** Sugar for Bedrock / Anthropic round trips. */
export function logLlmCall(args: {
  vendor: 'bedrock' | 'anthropic' | 'openai'
  model: string
  duration_ms: number
  ok: boolean
  input_tokens?: number
  output_tokens?: number
  practice_id?: string | null
  status_code?: number
  error?: string
}): void {
  logEvent({
    event: `llm.${args.vendor}.call`,
    severity: args.ok ? 'info' : 'warn',
    ok: args.ok,
    duration_ms: args.duration_ms,
    actor_practice_id: args.practice_id,
    status_code: args.status_code,
    ctx: {
      model: args.model,
      input_tokens: args.input_tokens,
      output_tokens: args.output_tokens,
      error: args.error,
    },
  })
}

/** Sugar for Cognito auth attempts. */
export function logAuthAttempt(args: {
  ok: boolean
  email?: string
  reason?: string
  practice_id?: string | null
  status_code?: number
}): void {
  logEvent({
    event: args.ok ? 'auth.cognito.success' : 'auth.cognito.failure',
    severity: args.ok ? 'info' : 'warn',
    ok: args.ok,
    actor_email: args.email ?? null,
    actor_practice_id: args.practice_id ?? null,
    status_code: args.status_code,
    ctx: { reason: args.reason },
  })
}
