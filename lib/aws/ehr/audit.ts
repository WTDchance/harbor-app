// EHR audit logging — Cognito + RDS port of lib/ehr/audit.ts.
//
// Every read/write of PHI (progress notes, treatment plans, safety plans,
// billing) should write a row into audit_logs. Failures are swallowed so the
// primary operation is never blocked, but they log to stderr so a broken
// audit table is visible in CloudWatch.

import { pool } from '@/lib/aws/db'
import type { ApiAuthContext } from '@/lib/aws/api-auth'

export type EhrAuditAction =
  | 'note.view'
  | 'note.list'
  | 'note.create'
  | 'note.update'
  | 'note.delete'
  | 'note.sign'
  | 'note.cosign'
  | 'note.amend'
  | 'note.draft_from_brief'
  | 'note.draft_from_call'
  | 'treatment_plan.view'
  | 'treatment_plan.list'
  | 'treatment_plan.create'
  | 'treatment_plan.update'
  | 'safety_plan.view'
  | 'safety_plan.list'
  | 'safety_plan.create'
  | 'safety_plan.update'
  | 'billing.charge.list'
  | 'billing.charge.create'
  | 'billing.invoice.list'
  | 'billing.invoice.create'

export async function auditEhrAccess(params: {
  ctx: ApiAuthContext
  action: EhrAuditAction
  resourceType?: string
  resourceId?: string | null
  details?: Record<string, unknown>
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, user_email, practice_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        params.ctx.user.id,
        params.ctx.session.email,
        params.ctx.practiceId,
        params.action,
        params.resourceType ?? 'ehr_progress_note',
        params.resourceId ?? null,
        JSON.stringify(params.details ?? {}),
      ],
    )
  } catch (err) {
    // Swallow — audit must never block the primary op. Log so a broken
    // audit table is visible in CloudWatch.
    console.error('[audit] insert failed:', (err as Error).message)
  }
}
