// lib/aws/llm.ts
//
// Wave 34 — Sonnet wrapper that routes to AWS Bedrock OR direct
// Anthropic API based on env. Bedrock is HIPAA-covered under our AWS
// BAA at $0 marginal BAA cost; the direct Anthropic API requires
// Anthropic's Enterprise plan for HIPAA. Default behavior:
//   - LLM_PROVIDER=bedrock (default if Bedrock IAM is wired) → Bedrock
//   - LLM_PROVIDER=anthropic                                 → direct API
//   - unset                                                   → Bedrock
//
// Caller-facing API mirrors `anthropic.messages.create({ model, system,
// messages, max_tokens })` so existing routes don't need to change shape.

import Anthropic from '@anthropic-ai/sdk'
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message as BedrockMessage,
} from '@aws-sdk/client-bedrock-runtime'

export interface LlmContent {
  type: 'text'
  text: string
}

export interface LlmCreateMessageArgs {
  model?: string
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  max_tokens?: number
  temperature?: number
}

export interface LlmCreateMessageResult {
  content: LlmContent[]
  stop_reason?: string | null
  usage?: { input_tokens: number; output_tokens: number }
}

const PROVIDER = (process.env.LLM_PROVIDER || 'bedrock').toLowerCase()
const BEDROCK_MODEL = process.env.BEDROCK_SONNET_MODEL || 'us.anthropic.claude-sonnet-4-6-v1:0'
const BEDROCK_REGION = process.env.BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1'

function bedrockClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({ region: BEDROCK_REGION })
}

async function bedrockCreate(args: LlmCreateMessageArgs): Promise<LlmCreateMessageResult> {
  const client = bedrockClient()
  const messages: BedrockMessage[] = args.messages.map(m => ({
    role: m.role,
    content: [{ text: m.content }],
  }))
  const inferenceConfig: any = {}
  if (args.max_tokens != null) inferenceConfig.maxTokens = args.max_tokens
  if (args.temperature != null) inferenceConfig.temperature = args.temperature

  const cmd = new ConverseCommand({
    modelId: args.model || BEDROCK_MODEL,
    system: args.system ? [{ text: args.system }] : undefined,
    messages,
    inferenceConfig,
  })
  const resp = await client.send(cmd)

  const content: LlmContent[] = []
  for (const b of resp.output?.message?.content ?? []) {
    if ('text' in b && b.text) content.push({ type: 'text', text: b.text })
  }
  return {
    content,
    stop_reason: resp.stopReason,
    usage: resp.usage
      ? { input_tokens: resp.usage.inputTokens ?? 0, output_tokens: resp.usage.outputTokens ?? 0 }
      : undefined,
  }
}

async function anthropicCreate(args: LlmCreateMessageArgs): Promise<LlmCreateMessageResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
  const client = new Anthropic({ apiKey })
  const resp = await client.messages.create({
    model: args.model || 'claude-sonnet-4-6',
    max_tokens: args.max_tokens ?? 1024,
    system: args.system,
    messages: args.messages,
    temperature: args.temperature,
  } as any)

  const content: LlmContent[] = []
  for (const b of resp.content as any[]) {
    if (b.type === 'text' && b.text) content.push({ type: 'text', text: b.text })
  }
  return {
    content,
    stop_reason: (resp as any).stop_reason,
    usage: (resp as any).usage
      ? { input_tokens: (resp as any).usage.input_tokens ?? 0, output_tokens: (resp as any).usage.output_tokens ?? 0 }
      : undefined,
  }
}

/**
 * Drop-in replacement for `anthropic.messages.create`. Routes to
 * Bedrock by default; falls back to the direct Anthropic API if
 * LLM_PROVIDER=anthropic OR if Bedrock fails for any reason.
 */
export async function createMessage(args: LlmCreateMessageArgs): Promise<LlmCreateMessageResult> {
  if (PROVIDER === 'anthropic') {
    return anthropicCreate(args)
  }
  // Bedrock first; fallback to direct Anthropic on Bedrock failure so a
  // misconfig doesn't take down AI features in prod. Logged but not thrown.
  try {
    return await bedrockCreate(args)
  } catch (err) {
    console.error('[lib/aws/llm] Bedrock failed, falling back to Anthropic:', (err as Error).message)
    if (!process.env.ANTHROPIC_API_KEY) throw err
    return anthropicCreate(args)
  }
}

/**
 * Returns 'bedrock' or 'anthropic' to make health-check / ops surfaces
 * accurate. Determined by env var only — does not perform a probe.
 */
export function llmProvider(): 'bedrock' | 'anthropic' {
  return PROVIDER === 'anthropic' ? 'anthropic' : 'bedrock'
}
