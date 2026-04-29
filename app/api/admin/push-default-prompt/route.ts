// app/api/admin/push-default-prompt/route.ts
//
// Admin endpoint that pushes HARBOR_DEFAULT_RECEPTIONIST_PROMPT to
// every existing practice's Retell LLM. Idempotent (Retell update
// is a PATCH; same input yields same state). Skips practices that
// have a non-empty ai_prompt_override (they explicitly customized).
//
// Use case: we've improved the canonical Harbor receptionist prompt
// in code and want existing practices to pick it up without manual
// dashboard edits.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { updateRetellLlmPrompt } from '@/lib/aws/retell/llm-update'
import { HARBOR_DEFAULT_RECEPTIONIST_PROMPT } from '@/lib/aws/retell/default-prompt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean }
  const dryRun = body.dry_run === true

  const { rows } = await pool.query(
    `SELECT id, name, retell_llm_id
       FROM practices
      WHERE retell_llm_id IS NOT NULL
        AND (ai_prompt_override IS NULL OR ai_prompt_override = '')
      ORDER BY created_at ASC`,
  )

  type Result = { practice_id: string; name: string; ok?: boolean; error?: string; skipped?: string }
  const results: Result[] = []

  for (const r of rows) {
    if (dryRun) {
      results.push({ practice_id: r.id, name: r.name, skipped: 'dry_run' })
      continue
    }
    const out = await updateRetellLlmPrompt({
      llmId: r.retell_llm_id,
      generalPrompt: HARBOR_DEFAULT_RECEPTIONIST_PROMPT,
    })
    results.push({
      practice_id: r.id,
      name: r.name,
      ok: out.ok,
      error: out.ok ? undefined : out.error,
    })
  }

  await auditEhrAccess({
    ctx,
    action: 'admin.run_migration',
    resourceType: 'retell_llm_bulk_push',
    resourceId: null,
    details: {
      dry_run: dryRun,
      practice_count: results.length,
      success_count: results.filter(r => r.ok).length,
      failure_count: results.filter(r => r.error).length,
    },
  })

  return NextResponse.json({
    dry_run: dryRun,
    practice_count: results.length,
    success_count: results.filter(r => r.ok).length,
    failure_count: results.filter(r => r.error).length,
    results,
  })
}
