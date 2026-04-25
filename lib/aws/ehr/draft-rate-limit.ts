// SOAP draft rate limit — 100 AI-drafted notes per practice per UTC day.
//
// Counts audit_logs rows for the practice with action 'note.draft.%' since
// 00:00 UTC today. The audit_logs table is the source of truth: every
// successful draft writes one audit row (per the existing draft-from-call
// + draft-from-brief flows), so the count is consistent with what the
// therapist actually sees in their note list.
//
// Fail-open: if audit_logs is unreachable, allow the draft. We'd rather
// the cap miscount briefly than block a therapist's workflow on an infra
// hiccup. The per-call Anthropic API call still has Anthropic-side rate
// limits as a backstop.

import { pool } from '@/lib/aws/db'

export const DRAFT_DAILY_CAP = 100

export type DraftRateLimit = {
  allowed: boolean
  used: number
  cap: number
}

export async function checkDraftRateLimit(
  practiceId: string,
): Promise<DraftRateLimit> {
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS used
         FROM audit_logs
        WHERE practice_id = $1
          AND action LIKE 'note.draft.%'
          AND timestamp >= $2`,
      [practiceId, todayStart.toISOString()],
    )
    const used = rows[0]?.used ?? 0
    return { allowed: used < DRAFT_DAILY_CAP, used, cap: DRAFT_DAILY_CAP }
  } catch {
    return { allowed: true, used: 0, cap: DRAFT_DAILY_CAP }
  }
}
