// app/api/admin/push-default-prompt/route.ts
//
// Admin endpoint that pushes the canonical Harbor receptionist
// configuration to every existing practice's Retell LLM + agent.
// Idempotent (Retell PATCH; same input yields same state).
//
// Body flags:
//   { update_prompt?: boolean = true, update_voice?: boolean = false,
//     dry_run?: boolean = false }
//
// Skip rules:
//   - prompt: skip practices with non-empty ai_prompt_override
//     (they explicitly customized — don't clobber).
//   - voice: skip practices with non-NULL ai_voice_id
//     (they explicitly picked a voice).
//
// Use case: we've improved the canonical Harbor receptionist prompt
// and/or default voice in code and want existing practices to pick it
// up without manual dashboard edits.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { updateRetellLlmPrompt, updateRetellAgentVoice } from '@/lib/aws/retell/llm-update'
import {
  HARBOR_DEFAULT_RECEPTIONIST_PROMPT,
  HARBOR_DEFAULT_RETELL_VOICE_ID,
} from '@/lib/aws/retell/default-prompt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  const body = (await req.json().catch(() => ({}))) as {
    dry_run?: boolean
    update_prompt?: boolean
    update_voice?: boolean
  }
  const dryRun = body.dry_run === true
  const updatePrompt = body.update_prompt !== false  // default true (back-compat)
  const updateVoice = body.update_voice === true     // default false (opt-in)

  const { rows } = await pool.query(
    `SELECT id, name, retell_llm_id, retell_agent_id,
            ai_prompt_override, ai_voice_id
       FROM practices
      WHERE retell_llm_id IS NOT NULL
      ORDER BY created_at ASC`,
  )

  type Result = {
    practice_id: string
    name: string
    prompt?: { ok?: boolean; error?: string; skipped?: string }
    voice?: { ok?: boolean; error?: string; skipped?: string }
  }
  const results: Result[] = []

  for (const r of rows) {
    const result: Result = { practice_id: r.id, name: r.name }

    if (updatePrompt) {
      const hasOverride = typeof r.ai_prompt_override === 'string' && r.ai_prompt_override.trim().length > 0
      if (hasOverride) {
        result.prompt = { skipped: 'ai_prompt_override_set' }
      } else if (dryRun) {
        result.prompt = { skipped: 'dry_run' }
      } else {
        const out = await updateRetellLlmPrompt({
          llmId: r.retell_llm_id,
          generalPrompt: HARBOR_DEFAULT_RECEPTIONIST_PROMPT,
        })
        result.prompt = { ok: out.ok, error: out.ok ? undefined : out.error }
      }
    }

    if (updateVoice) {
      if (!r.retell_agent_id) {
        result.voice = { skipped: 'no_retell_agent_id' }
      } else if (typeof r.ai_voice_id === 'string' && r.ai_voice_id.trim().length > 0) {
        result.voice = { skipped: 'ai_voice_id_set' }
      } else if (dryRun) {
        result.voice = { skipped: 'dry_run' }
      } else {
        const out = await updateRetellAgentVoice({
          agentId: r.retell_agent_id,
          voiceId: HARBOR_DEFAULT_RETELL_VOICE_ID,
        })
        result.voice = { ok: out.ok, error: out.ok ? undefined : out.error }
      }
    }

    results.push(result)
  }

  const promptOk = results.filter(r => r.prompt?.ok === true).length
  const promptErr = results.filter(r => r.prompt?.error).length
  const promptSkip = results.filter(r => r.prompt?.skipped).length
  const voiceOk = results.filter(r => r.voice?.ok === true).length
  const voiceErr = results.filter(r => r.voice?.error).length
  const voiceSkip = results.filter(r => r.voice?.skipped).length

  await auditEhrAccess({
    ctx,
    action: 'admin.run_migration',
    resourceType: 'retell_llm_bulk_push',
    resourceId: null,
    details: {
      dry_run: dryRun,
      update_prompt: updatePrompt,
      update_voice: updateVoice,
      voice_id: updateVoice ? HARBOR_DEFAULT_RETELL_VOICE_ID : null,
      practice_count: results.length,
      prompt: { ok: promptOk, error: promptErr, skipped: promptSkip },
      voice: { ok: voiceOk, error: voiceErr, skipped: voiceSkip },
    },
  })

  return NextResponse.json({
    dry_run: dryRun,
    update_prompt: updatePrompt,
    update_voice: updateVoice,
    voice_id: updateVoice ? HARBOR_DEFAULT_RETELL_VOICE_ID : null,
    practice_count: results.length,
    prompt: { ok: promptOk, error: promptErr, skipped: promptSkip },
    voice: { ok: voiceOk, error: voiceErr, skipped: voiceSkip },
    results,
  })
}
