// lib/ehr/audit.ts
// Harbor EHR — audit log helper.
//
// Every read/write of a progress note (PHI) should write an audit row.
// The audit_logs table already exists at the practice level; we just
// append rows with resource_type='ehr_progress_note'. Failures are
// swallowed — audit should never block the primary operation, but
// repeated failures show up in server logs.

import type { User } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'

export type EhrAuditAction =
  | 'note.view'
  | 'note.list'
  | 'note.create'
  | 'note.update'
  | 'note.delete'
  | 'note.sign'
  | 'note.amend'
  | 'note.draft_from_brief'
  | 'note.draft_from_call'

export async function auditEhrAccess(params: {
  user: User | { id: string; email?: string | null }
  practiceId: string
  action: EhrAuditAction
  resourceId?: string | null
  details?: Record<string, unknown>
  severity?: 'info' | 'warning' | 'critical'
}): Promise<void> {
  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id: params.user.id,
      user_email: params.user.email ?? null,
      practice_id: params.practiceId,
      action: params.action,
      resource_type: 'ehr_progress_note',
      resource_id: params.resourceId ?? null,
      details: params.details ?? null,
      severity: params.severity ?? 'info',
    })
  } catch (err) {
    // Audit writes must never break the user-facing path. Log + continue.
    console.error('[ehr-audit] failed to write audit row', {
      action: params.action,
      resourceId: params.resourceId,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}
