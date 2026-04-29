// AWS SES email client for Harbor.
//
// Two layers:
//
//   1. sendViaSes()          — low-level wrapper. Resend-compat surface.
//                              Existing callers (lib/email.ts, lib/reminder-email.ts,
//                              app/api/admin/email-health) keep using it
//                              unchanged.
//
//   2. sendTransactionalEmail() — Wave 50 high-level wrapper. Routes a
//                              templated, suppression-checked, preference-
//                              checked, audit-logged send through the
//                              configured SES configuration set.
//
// Production note: SES starts in "sandbox mode" — the account can only send
// to verified email addresses until AWS approves a sandbox-removal request.
// Once approved, no code change is needed; the same wrapper handles 200/day
// (sandbox) and full production volume.
//
// IAM caveat: the ECS task role pins ses:FromAddress to a single address
// (var.ses_from_address). The legacy multi-from convention (Chance@/Sales@/
// Support@) is preserved via Reply-To rather than From.

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import { pool } from './db'
import { auditSystemEvent } from './ehr/audit'
import {
  type TemplateId,
  type EmailCategory,
  getTemplate,
  preferenceColumnFor,
  renderTemplate,
} from './email-templates'

// ─── Clients (lazy, per-process singletons) ──────────────────────────────

let _client: SESClient | null = null

function getClient(): SESClient {
  if (!_client) {
    _client = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' })
  }
  return _client
}

export function sesFromAddress(): string {
  return (
    process.env.SES_FROM_ADDRESS ||
    process.env.RESEND_FROM_EMAIL || // legacy fallback during migration
    'ellie@harboroffice.ai'
  )
}

function configurationSetName(): string | undefined {
  // Configured by terraform (infra/terraform/ses.tf). Falls back to
  // undefined in dev so SES doesn't reject the send for an unknown set.
  return process.env.SES_CONFIGURATION_SET || undefined
}

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'https://harborreceptionist.com'
  )
}

// ─── Legacy low-level wrapper (unchanged surface) ────────────────────────

export type SesPayload = {
  to: string
  subject: string
  html: string
  text?: string
  /** Caller's intended sender — moves into Reply-To since SES Source is
   *  pinned by IAM. */
  replyTo?: string
}

export async function sendViaSes(payload: SesPayload): Promise<boolean> {
  const source = sesFromAddress()

  const replyToAddresses: string[] = []
  if (payload.replyTo && payload.replyTo !== source) {
    const m = payload.replyTo.match(/<([^>]+)>/)
    replyToAddresses.push(m ? m[1] : payload.replyTo)
  }

  const cmd = new SendEmailCommand({
    Source: source,
    Destination: { ToAddresses: [payload.to] },
    Message: {
      Subject: { Data: payload.subject, Charset: 'UTF-8' },
      Body: {
        Html: { Data: payload.html, Charset: 'UTF-8' },
        ...(payload.text ? { Text: { Data: payload.text, Charset: 'UTF-8' } } : {}),
      },
    },
    ReplyToAddresses: replyToAddresses.length ? replyToAddresses : undefined,
  })

  try {
    await getClient().send(cmd)
    console.log(`[ses] sent to ${payload.to}: ${payload.subject}`)
    return true
  } catch (err) {
    const e = err as Error & { name?: string }
    if (e?.name === 'MessageRejected' || /not verified|sandbox/i.test(e?.message || '')) {
      console.warn('[ses] send rejected (likely sandbox / unverified):', e.message)
    } else {
      console.error('[ses] send failed:', e.message, e.name)
    }
    return false
  }
}

// ─── Wave 50 high-level wrapper ──────────────────────────────────────────

export type TransactionalEmailParams = {
  /** Recipient email address. */
  to: string
  /** Template ID from EMAIL_TEMPLATES registry. */
  template: TemplateId
  /** Variables substituted into the template. Required variables are
   *  validated by renderTemplate() — missing values throw before send. */
  variables: Record<string, string | number | undefined | null>
  /** Practice scope. NULL is allowed for system-level sends (e.g.
   *  Harbor-platform admin onboarding) — the wrapper logs without a
   *  practice_id and skips per-practice branding. */
  practice_id: string | null
  /** Audit-log action verb (free-form, mirrors auditSystemEvent.action).
   *  Defaults to `email.${template}`. */
  audit_event_type?: string
  /** Optional: link the send to a user/patient row so we can flip their
   *  soft-bounce counter on bounce. The webhook resolves recipients by
   *  email so this is purely an optimization. */
  recipient_user_id?: string | null
  recipient_patient_id?: string | null
}

export type TransactionalSendResult =
  | { ok: true; messageId: string; logId: number }
  | { ok: false; reason: 'suppressed' | 'opted_out' | 'send_failed' | 'invalid_recipient' | 'template_error'; logId: number | null; error?: string }

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Top-level transactional send.
 *
 * Pipeline:
 *   1. Validate recipient format. Bad format → invalid_format suppression
 *      row + log + return.
 *   2. Check suppression list. If suppressed → log + audit + return.
 *   3. Check user/patient notification preferences. If opted out (and the
 *      template is not alwaysSend) → log + audit + return.
 *   4. Resolve practice branding (name, address, phone) from practices.
 *   5. Render template (subject, html, text).
 *   6. SESv2 SendEmail with the configured configuration set.
 *   7. Insert email_send_log row + auditSystemEvent.
 *
 * Returns the SES MessageId on success, or { ok: false, reason } on a
 * non-error skip (suppressed, opted_out, invalid_recipient).
 */
export async function sendTransactionalEmail(
  params: TransactionalEmailParams,
): Promise<TransactionalSendResult> {
  const recipient = (params.to || '').trim()
  const template = getTemplate(params.template)
  const auditAction = params.audit_event_type ?? `email.${template.templateId}`

  // ─── 1. Format validation
  if (!VALID_EMAIL.test(recipient)) {
    const logId = await insertSendLog({
      practice_id: params.practice_id,
      recipient_email: recipient,
      template_id: template.templateId,
      category: template.category,
      status: 'suppressed',
      error_message: 'invalid_format',
    })
    // Add to suppression list so we don't keep retrying the same bad addr.
    await insertSuppression({
      email: recipient,
      reason: 'invalid_format',
      practice_id: params.practice_id,
    })
    await auditSystemEvent({
      action: auditAction,
      practiceId: params.practice_id,
      severity: 'warning',
      details: { recipient, template_id: template.templateId, skipped: 'invalid_format' },
      resourceType: 'email_send',
      resourceId: String(logId ?? ''),
    })
    return { ok: false, reason: 'invalid_recipient', logId }
  }

  // ─── 2. Suppression check
  const suppressed = await isSuppressed(recipient, params.practice_id)
  if (suppressed) {
    const logId = await insertSendLog({
      practice_id: params.practice_id,
      recipient_email: recipient,
      template_id: template.templateId,
      category: template.category,
      status: 'suppressed',
      error_message: `suppressed:${suppressed.reason}`,
    })
    await auditSystemEvent({
      action: auditAction,
      practiceId: params.practice_id,
      severity: 'warning',
      details: {
        recipient,
        template_id: template.templateId,
        skipped: 'suppressed',
        suppression_reason: suppressed.reason,
      },
      resourceType: 'email_send',
      resourceId: String(logId ?? ''),
    })
    return { ok: false, reason: 'suppressed', logId, error: suppressed.reason }
  }

  // ─── 3. Preference check
  if (!template.alwaysSend) {
    const optedOut = await isOptedOut({
      recipient,
      practice_id: params.practice_id,
      category: template.category,
    })
    if (optedOut) {
      const logId = await insertSendLog({
        practice_id: params.practice_id,
        recipient_email: recipient,
        template_id: template.templateId,
        category: template.category,
        status: 'suppressed',
        error_message: 'opted_out',
      })
      await auditSystemEvent({
        action: auditAction,
        practiceId: params.practice_id,
        severity: 'info',
        details: {
          recipient,
          template_id: template.templateId,
          skipped: 'opted_out',
          category: template.category,
        },
        resourceType: 'email_send',
        resourceId: String(logId ?? ''),
      })
      return { ok: false, reason: 'opted_out', logId }
    }
  }

  // ─── 4. Branding lookup
  const branding = await loadBranding(params.practice_id)

  // ─── 5. Render
  let rendered
  try {
    rendered = renderTemplate(template.templateId as TemplateId, params.variables, {
      practiceName: branding.practiceName,
      practiceAddress: branding.practiceAddress,
      practicePhone: branding.practicePhone,
      manageNotificationsUrl: `${appUrl()}/portal/settings/notifications`,
    })
  } catch (err) {
    const logId = await insertSendLog({
      practice_id: params.practice_id,
      recipient_email: recipient,
      template_id: template.templateId,
      category: template.category,
      status: 'failed',
      error_message: `template_error:${(err as Error).message}`,
    })
    await auditSystemEvent({
      action: auditAction,
      practiceId: params.practice_id,
      severity: 'critical',
      details: {
        recipient,
        template_id: template.templateId,
        error: (err as Error).message,
      },
      resourceType: 'email_send',
      resourceId: String(logId ?? ''),
    })
    return { ok: false, reason: 'template_error', logId, error: (err as Error).message }
  }

  // ─── 6. SES send
  const cmd = new SendEmailCommand({
    Source: sesFromAddress(),
    Destination: { ToAddresses: [recipient] },
    ConfigurationSetName: configurationSetName(),
    Message: {
      Subject: { Data: rendered.subject, Charset: 'UTF-8' },
      Body: {
        Html: { Data: rendered.html, Charset: 'UTF-8' },
        Text: { Data: rendered.text, Charset: 'UTF-8' },
      },
    },
    Tags: [
      { Name: 'template_id', Value: template.templateId },
      { Name: 'category', Value: template.category },
      ...(params.practice_id
        ? [{ Name: 'practice_id', Value: params.practice_id }]
        : []),
    ],
  })

  let messageId: string | null = null
  let sendError: Error | null = null
  try {
    const out = await getClient().send(cmd)
    messageId = out.MessageId ?? null
  } catch (err) {
    sendError = err as Error
  }

  // ─── 7. Log + audit
  if (messageId) {
    const logId = await insertSendLog({
      practice_id: params.practice_id,
      recipient_email: recipient,
      template_id: template.templateId,
      category: template.category,
      ses_message_id: messageId,
      status: 'sent',
      metadata: {
        recipient_user_id: params.recipient_user_id ?? null,
        recipient_patient_id: params.recipient_patient_id ?? null,
        subject: rendered.subject,
      },
    })
    await auditSystemEvent({
      action: auditAction,
      practiceId: params.practice_id,
      severity: 'info',
      details: {
        recipient,
        template_id: template.templateId,
        category: template.category,
        ses_message_id: messageId,
      },
      resourceType: 'email_send',
      resourceId: String(logId ?? ''),
    })
    return { ok: true, messageId, logId: logId ?? -1 }
  }

  // Send failed
  const isSandboxRejection =
    sendError?.name === 'MessageRejected' ||
    /not verified|sandbox/i.test(sendError?.message || '')
  const logId = await insertSendLog({
    practice_id: params.practice_id,
    recipient_email: recipient,
    template_id: template.templateId,
    category: template.category,
    status: 'failed',
    error_message: sendError?.message || 'unknown',
  })
  await auditSystemEvent({
    action: auditAction,
    practiceId: params.practice_id,
    severity: isSandboxRejection ? 'warning' : 'critical',
    details: {
      recipient,
      template_id: template.templateId,
      error: sendError?.message,
      error_name: sendError?.name,
      sandbox_rejection: isSandboxRejection,
    },
    resourceType: 'email_send',
    resourceId: String(logId ?? ''),
  })
  if (isSandboxRejection) {
    console.warn('[ses] send rejected (sandbox / unverified):', sendError?.message)
  } else {
    console.error('[ses] send failed:', sendError?.message)
  }
  return { ok: false, reason: 'send_failed', logId, error: sendError?.message }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function insertSendLog(row: {
  practice_id: string | null
  recipient_email: string
  template_id: string
  category: EmailCategory | string
  ses_message_id?: string | null
  status: 'sent' | 'suppressed' | 'failed' | 'bounced' | 'complaint' | 'delivered'
  error_message?: string | null
  metadata?: Record<string, unknown>
}): Promise<number | null> {
  try {
    const r = await pool.query<{ id: number }>(
      `INSERT INTO email_send_log
         (practice_id, recipient_email, template_id, category,
          ses_message_id, status, error_message, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id`,
      [
        row.practice_id,
        row.recipient_email,
        row.template_id,
        row.category,
        row.ses_message_id ?? null,
        row.status,
        row.error_message ?? null,
        JSON.stringify(row.metadata ?? {}),
      ],
    )
    return r.rows[0]?.id ?? null
  } catch (err) {
    console.error('[ses] failed to insert email_send_log:', (err as Error).message)
    return null
  }
}

async function insertSuppression(row: {
  email: string
  reason: 'hard_bounce' | 'complaint' | 'manual' | 'invalid_format'
  practice_id: string | null
  source_message_id?: string | null
  notes?: string | null
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO ses_suppression_list (email, reason, practice_id, source_message_id, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (LOWER(email), COALESCE(practice_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO NOTHING`,
      [
        row.email.toLowerCase(),
        row.reason,
        row.practice_id,
        row.source_message_id ?? null,
        row.notes ?? null,
      ],
    )
  } catch (err) {
    console.error('[ses] failed to insert suppression:', (err as Error).message)
  }
}

async function isSuppressed(
  email: string,
  practice_id: string | null,
): Promise<{ reason: string } | null> {
  try {
    const r = await pool.query<{ reason: string }>(
      `SELECT reason
         FROM ses_suppression_list
        WHERE LOWER(email) = LOWER($1)
          AND (practice_id IS NULL OR practice_id = $2)
        LIMIT 1`,
      [email, practice_id],
    )
    return r.rows[0] ?? null
  } catch (err) {
    // Fail-open: if the suppression check itself errors, log and allow
    // the send. Better to risk a duplicate to a bounced recipient than to
    // block a legitimate password-reset email because the table is gone.
    console.error('[ses] suppression check failed (allowing send):', (err as Error).message)
    return null
  }
}

async function isOptedOut(args: {
  recipient: string
  practice_id: string | null
  category: EmailCategory
}): Promise<boolean> {
  const col = preferenceColumnFor(args.category)
  if (!col) return false // alwaysSend categories
  // Patients first (portal-side recipient is the common case for
  // appointment reminders / intake invites). Then fall back to users
  // (therapist-facing — credentialing alerts).
  try {
    const patientRow = await pool.query<{ enabled: boolean }>(
      `SELECT ${col === 'credentialing_alerts_enabled' ? 'TRUE' : col} AS enabled
         FROM patients
        WHERE LOWER(email) = LOWER($1)
          AND ($2::uuid IS NULL OR practice_id = $2::uuid)
        LIMIT 1`,
      [args.recipient, args.practice_id],
    )
    if (patientRow.rows.length > 0) {
      return patientRow.rows[0].enabled === false
    }
  } catch {
    /* fall through */
  }
  try {
    const userRow = await pool.query<{ enabled: boolean }>(
      `SELECT ${col} AS enabled
         FROM users
        WHERE LOWER(email) = LOWER($1)
          AND ($2::uuid IS NULL OR practice_id = $2::uuid)
        LIMIT 1`,
      [args.recipient, args.practice_id],
    )
    if (userRow.rows.length > 0) {
      return userRow.rows[0].enabled === false
    }
  } catch {
    /* fall through */
  }
  // Recipient not on file (could be a one-off send to a prospect).
  // Default to allowing the send.
  return false
}

async function loadBranding(
  practice_id: string | null,
): Promise<{
  practiceName: string
  practiceAddress: string
  practicePhone: string
}> {
  if (!practice_id) {
    return {
      practiceName: 'Harbor',
      practiceAddress: '',
      practicePhone: '',
    }
  }
  try {
    const r = await pool.query<{
      name: string
      address: string | null
      phone: string | null
    }>(
      `SELECT name,
              COALESCE(address, '') AS address,
              COALESCE(phone, twilio_phone_number, signalwire_number, '') AS phone
         FROM practices
        WHERE id = $1`,
      [practice_id],
    )
    const row = r.rows[0]
    return {
      practiceName: row?.name ?? 'Harbor',
      practiceAddress: row?.address ?? '',
      practicePhone: row?.phone ?? '',
    }
  } catch {
    return { practiceName: 'Harbor', practiceAddress: '', practicePhone: '' }
  }
}

// ─── Re-exports for callers ──────────────────────────────────────────────

export {
  insertSuppression as _insertSuppression, // exposed for SNS webhook + admin tools
  insertSendLog as _insertSendLog,
  isSuppressed as _isSuppressed,
}
