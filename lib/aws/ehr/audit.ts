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
  | 'note.amend.create'
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
  | 'consent.list'
  | 'consent.create'
  | 'group_session.list'
  | 'group_session.create'
  | 'message.list'
  | 'portal.login'
  | 'portal.logout'
  | 'portal.me.view'
  | 'portal.invoice.list'
  | 'portal.superbill.list'
  | 'portal.homework.list'
  | 'portal.assessment.list'
  | 'portal.message.list'
  | 'portal.scheduling.list'
  | 'portal.mood.list'
  | 'note.draft.create.from_call'
  | 'note.draft.create.from_brief'
  | 'note.draft.transcribe'
  | 'portal.mood.create'
  | 'portal.scheduling.create'
  | 'portal.homework.update'
  | 'portal.assessment.complete'
  | 'billing.payment.create'
  | 'intake.send'
  | 'intake.create'
  | 'intake.resend'
  | 'intake.submit'
  | 'intake.document.upload'

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


import type { PortalSession } from '@/lib/aws/portal-auth'

export type PortalAuditAction =
  | 'portal.login'
  | 'portal.logout'
  | 'portal.me.view'
  | 'portal.invoice.list'
  | 'portal.superbill.list'
  | 'portal.homework.list'
  | 'portal.assessment.list'
  | 'portal.message.list'
  | 'portal.scheduling.list'
  | 'portal.mood.list'
  | 'note.draft.create.from_call'
  | 'note.draft.create.from_brief'
  | 'note.draft.transcribe'
  | 'portal.mood.create'
  | 'portal.scheduling.create'
  | 'portal.homework.update'
  | 'portal.assessment.complete'

/**
 * Audit a portal patient action. Mirrors auditEhrAccess() but takes a
 * PortalSession instead of an ApiAuthContext — there is no Cognito user
 * for portal sessions. The session token hash (not the raw token) is
 * recorded in details so a leaked audit log can't be replayed.
 */
export async function auditPortalAccess(params: {
  session: PortalSession
  action: PortalAuditAction
  resourceType?: string
  resourceId?: string | null
  details?: Record<string, unknown>
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs (
         user_id, user_email, practice_id, action, resource_type, resource_id, details
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        null, // patient is not a Cognito user
        null,
        params.session.practiceId,
        params.action,
        params.resourceType ?? 'portal',
        params.resourceId ?? null,
        JSON.stringify({
          ...(params.details ?? {}),
          patient_id: params.session.patientId,
          session_token_hash: params.session.sessionTokenHash,
        }),
      ],
    )
  } catch (err) {
    console.error('[audit] portal insert failed:', (err as Error).message)
  }
}


/**
 * Cron + system-level audit events. No Cognito user, no practice scope —
 * just a row in audit_logs so the tick is visible in CloudWatch + the
 * audit-export endpoint.
 */
export async function auditSystemEvent(params: {
  action: string
  details?: Record<string, unknown>
  resourceType?: string
  resourceId?: string | null
  practiceId?: string | null
  severity?: 'info' | 'warn' | 'error'
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs (
         user_id, user_email, practice_id, action,
         resource_type, resource_id, details, severity
       ) VALUES (NULL, NULL, $1, $2, $3, $4, $5::jsonb, $6)`,
      [
        params.practiceId ?? null,
        params.action,
        params.resourceType ?? 'cron',
        params.resourceId ?? null,
        JSON.stringify(params.details ?? {}),
        params.severity ?? 'info',
      ],
    )
  } catch (err) {
    console.error('[audit] system insert failed:', (err as Error).message)
  }
}
