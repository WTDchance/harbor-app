// SOAP draft + AI side-effect rate limit — 100 AI-generated artifacts per
// practice per UTC day.
//
// Counts audit_logs rows for the practice with action matching the family
// LIKE pattern since 00:00 UTC today. The audit_logs table is the source
// of truth: every successful draft / AI interpretation writes one audit
// row, so the count is consistent with what the therapist actually sees.
//
// Fail-open: if audit_logs is unreachable, allow the call. We'd rather
// the cap miscount briefly than block a therapist's workflow on an infra
// hiccup. The per-call Anthropic API call still has Anthropic-side rate
// limits as a backstop.

import { pool } from '@/lib/aws/db'

export const DRAFT_DAILY_CAP = 100

export type AiCapFamily =
  | 'note.draft.%'           // SOAP drafts (Wave 7)
  | 'patient.summary.%'      // Wave 17 — Sonnet patient briefing
  | 'assessment.interpret'   // Wave 17 — Sonnet score interpretation
  | 'ai.%'                   // catch-all for future AI

export type DraftRateLimit = {
  allowed: boolean
  used: number
  cap: number
}

/**
 * Default cap check — counts only the SOAP draft family.
 * Kept for backward compat with Wave 7 callers (draft-from-call etc.).
 */
export async function checkDraftRateLimit(
  practiceId: string,
): Promise<DraftRateLimit> {
  return checkAiRateLimit(practiceId, 'note.draft.%')
}

/**
 * Family-scoped cap check. Wave 17 callers pass 'patient.summary.%' or
 * 'assessment.interpret' so a therapist binge-generating one type of AI
 * artifact doesn't burn the cap for the others.
 */
export async function checkAiRateLimit(
  practiceId: string,
  family: AiCapFamily,
): Promise<DraftRateLimit> {
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS used
         FROM audit_logs
        WHERE practice_id = $1
          AND action LIKE $2
          AND timestamp >= $3`,
      [practiceId, family, todayStart.toISOString()],
    )
    const used = rows[0]?.used ?? 0
    return { allowed: used < DRAFT_DAILY_CAP, used, cap: DRAFT_DAILY_CAP }
  } catch {
    return { allowed: true, used: 0, cap: DRAFT_DAILY_CAP }
  }
}
