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
  | 'note.supervisor_cosigned'
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
  | 'biopsychosocial.view'
  | 'biopsychosocial.list'
  | 'biopsychosocial.create'
  | 'biopsychosocial.update'
  | 'biopsychosocial.complete'
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
  | 'portal.superbill.generate'
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
  | 'billing.subscription.created'
  | 'billing.subscription.updated'
  | 'billing.subscription.cancelled'
  | 'billing.invoice.paid'
  | 'billing.invoice.failed'
  | 'billing.invoice.voided'
  | 'billing.invoice.finalized'
  | 'billing.invoice.action_required'
  | 'billing.payment.failed'
  | 'billing.claims.submit'
  | 'billing.superbill.generate'
  | 'billing.portal.session'
  | 'provision.checkout_completed'
  | 'consent.sign'
  | 'message.thread.upsert'
  | 'message.send'
  | 'message.read'
  | 'note.draft.candidates.list'
  | 'patient.summary.generate'
  | 'patient.summary.view'
  | 'patient.continuity_summary.view'
  | 'patient.export'
  | 'assessment.interpret'
  | 'admin.run_migration'
  | 'admin.seed_patient'
  | 'admin.repair_practice'
  | 'admin.update_practice'
  | 'admin.bootstrap_password'
  | 'admin.act_as.set'
  | 'admin.act_as.clear'
  | 'admin.patient.delete'
  | 'provision.signup_received'
  | 'provision.created'
  | 'provision.linked_carrier'
  | 'patients.export'
  | 'patients.verify_identity'
  | 'admin.practice.decommission'
  | 'patient.phi.exported'
  | 'practice.phi.exported'
  | 'no_show.email_sent'
  | 'no_show.email_skipped'
  | 'mental_status_exam.viewed'
  | 'mental_status_exam.created'
  | 'mental_status_exam.updated'
  | 'mental_status_exam.completed'
  | 'discharge_summary.viewed'
  | 'discharge_summary.created'
  | 'discharge_summary.updated'
  | 'discharge_summary.completed'
  | 'treatment_plan_review.viewed'
  | 'treatment_plan_review.created'
  | 'treatment_plan_review.cosigned'
  | 'mandatory_report.created'
  | 'mandatory_report.viewed'
  | 'mandatory_report.updated'
  | 'mandatory_report.filed'
  | 'mandatory_report.closed'
  // Wave 39 — audit-gap closure (8 routes flagged in docs/hipaa-audit-matrix.md).
  // Names finalised against docs/audit-gap-proposals.md.
  | 'appointment.session.view'
  | 'appointment.session.start'
  | 'appointment.session.stop'
  | 'appointment.session.reset'
  | 'homework.update'
  | 'homework.complete'
  | 'message.thread.view'
  | 'mood.list'
  | 'diagnoses.recent.list'
  | 'admin.patient.list'
  | 'admin.roi_lead.list'
  | 'admin.roi_lead.update'
  | 'admin.support_ticket.list'
  | 'practice.sliding_fee.configured'
  | 'patient.fee_tier.set'
  | 'patient.outcomes.viewed'
  | 'disclosure.create'
  | 'disclosure.view'
  | 'disclosure.list'
  | 'disclosure.update'
  | 'disclosure.accounting_generated'
  | 'appointment.patient.added'
  | 'appointment.patient.removed'
  | 'appointment.patient.list'
  | 'note.patient.added'
  | 'note.patient.removed'
  | 'note.patient.section_updated'
  | 'era.received'
  | 'era.parsed'
  | 'era.matched_auto'
  | 'era.matched_manual'
  | 'era.viewed'
  | 'claim.submitted'
  | 'claim.status_updated'
  | 'claim.rejected'
  | 'claim.accepted'
  // Wave 41 — 42 CFR Part 2 separate consent track.
  | 'part2_consent.create'
  | 'part2_consent.view'
  | 'part2_consent.list'
  | 'part2_consent.revoke'
  | 'part2_disclosure.create'
  | 'part2_disclosure.view'
  | 'part2_disclosure.list'
  | 'insurance_authorization.create'
  | 'insurance_authorization.update'
  | 'insurance_authorization.view'
  | 'insurance_authorization.list'
  | 'insurance_authorization.used'
  | 'admin.audit_log.viewed'
  | 'admin.audit_log.exported'
  | 'external_provider.create'
  | 'external_provider.update'
  | 'external_provider.view'
  | 'external_provider.list'
  | 'external_provider.delete'
  | 'patient.external_provider.link'
  | 'patient.external_provider.unlink'
  // Wave 42 — insurance-card scanner. Therapist snaps front/back of the
  // patient's card on their phone; backend uploads to the KMS-encrypted
  // insurance-cards S3 bucket, runs Textract AnalyzeDocument(FORMS), and
  // writes parsed fields back to the patient row. Append-only here to
  // minimise merge collision with Wave 41.
  | 'insurance_card.scanned'

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
  | 'portal.superbill.generate'
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
  | 'portal.message.send'
  | 'portal.consent.sign'
  | 'portal.superbill.download'

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
