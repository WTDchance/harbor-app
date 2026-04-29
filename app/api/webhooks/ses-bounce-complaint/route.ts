// Wave 50 — SNS bounce/complaint webhook.
//
// AWS SES is configured (terraform: infra/terraform/ses.tf) to publish
// Bounce, Complaint, and Delivery events to two SNS topics. Both topics
// HTTPS-deliver to this single endpoint. The handler:
//
//   1. Verifies the SNS signature (best-effort — see notes).
//   2. Handles SubscriptionConfirmation by GETting SubscribeURL.
//   3. Parses the SES event JSON inside Message.
//   4. For hard bounces and complaints: insert ses_suppression_list row
//      and update the linked email_send_log row.
//   5. For soft bounces: increment soft_bounce_count on the patient/user
//      row; alert the practice owner at >=3 in 30 days.
//   6. Audit-logs every event (info / warning / critical).
//
// SNS signature verification: SNS signs the canonical message with the
// signing cert at SigningCertURL. A full verifier is ~80 lines of crypto
// + cert parsing — we keep a defense-in-depth header check (TopicArn must
// be in the SES_SNS_TOPIC_ARNS allowlist) and the SubscriptionConfirmation
// auto-confirm. Real signature verification ships in a follow-up; this is
// a sandbox-only webhook today.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { sendViaSes } from '@/lib/aws/ses'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

type SnsEnvelope = {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation'
  MessageId: string
  TopicArn: string
  Subject?: string
  Message: string
  Timestamp: string
  SignatureVersion?: string
  Signature?: string
  SigningCertURL?: string
  SubscribeURL?: string
}

type SesBounceMessage = {
  notificationType: 'Bounce' | 'Complaint' | 'Delivery'
  bounce?: {
    bounceType: 'Permanent' | 'Transient' | 'Undetermined'
    bounceSubType?: string
    bouncedRecipients: Array<{ emailAddress: string; diagnosticCode?: string }>
    timestamp: string
    feedbackId: string
  }
  complaint?: {
    complainedRecipients: Array<{ emailAddress: string }>
    complaintFeedbackType?: string
    timestamp: string
    feedbackId: string
  }
  delivery?: {
    timestamp: string
    recipients: string[]
    smtpResponse?: string
  }
  mail: {
    messageId: string
    timestamp: string
    source: string
    destination: string[]
    tags?: Record<string, string[]>
  }
}

function topicArnAllowlisted(topicArn: string): boolean {
  const list = (process.env.SES_SNS_TOPIC_ARNS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (list.length === 0) return true // no allowlist configured = accept (dev)
  return list.includes(topicArn)
}

export async function POST(req: NextRequest) {
  let envelope: SnsEnvelope
  try {
    envelope = (await req.json()) as SnsEnvelope
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!envelope?.Type || !envelope.TopicArn) {
    return NextResponse.json({ error: 'invalid_envelope' }, { status: 400 })
  }
  if (!topicArnAllowlisted(envelope.TopicArn)) {
    await auditSystemEvent({
      action: 'ses.webhook.unauthorized_topic',
      severity: 'critical',
      details: { topic_arn: envelope.TopicArn, type: envelope.Type },
      resourceType: 'ses_webhook',
    })
    return NextResponse.json({ error: 'unauthorized_topic' }, { status: 403 })
  }

  // Subscription confirmation — auto-confirm by hitting SubscribeURL.
  if (envelope.Type === 'SubscriptionConfirmation' && envelope.SubscribeURL) {
    try {
      await fetch(envelope.SubscribeURL, { method: 'GET' })
      await auditSystemEvent({
        action: 'ses.webhook.subscription_confirmed',
        severity: 'info',
        details: { topic_arn: envelope.TopicArn },
        resourceType: 'ses_webhook',
      })
      return NextResponse.json({ ok: true, confirmed: true })
    } catch (err) {
      console.error('[ses-webhook] subscribe failed:', (err as Error).message)
      return NextResponse.json({ error: 'subscribe_failed' }, { status: 500 })
    }
  }

  if (envelope.Type !== 'Notification') {
    return NextResponse.json({ ok: true, ignored: envelope.Type })
  }

  let message: SesBounceMessage
  try {
    message = JSON.parse(envelope.Message) as SesBounceMessage
  } catch {
    await auditSystemEvent({
      action: 'ses.webhook.invalid_message',
      severity: 'warning',
      details: { sns_message_id: envelope.MessageId },
      resourceType: 'ses_webhook',
    })
    return NextResponse.json({ error: 'invalid_message' }, { status: 400 })
  }

  const sesMessageId = message.mail?.messageId
  const practiceTag = message.mail?.tags?.practice_id?.[0] ?? null

  if (message.notificationType === 'Bounce' && message.bounce) {
    await handleBounce(message, sesMessageId, practiceTag)
  } else if (message.notificationType === 'Complaint' && message.complaint) {
    await handleComplaint(message, sesMessageId, practiceTag)
  } else if (message.notificationType === 'Delivery' && message.delivery) {
    await handleDelivery(message, sesMessageId)
  }

  return NextResponse.json({ ok: true })
}

async function handleBounce(
  message: SesBounceMessage,
  sesMessageId: string,
  practiceId: string | null,
) {
  const bounce = message.bounce!
  const isHard = bounce.bounceType === 'Permanent'
  for (const recipient of bounce.bouncedRecipients) {
    const email = recipient.emailAddress
    if (isHard) {
      // Hard bounce — add to suppression list, mark log row bounced.
      await pool.query(
        `INSERT INTO ses_suppression_list (email, reason, practice_id, source_message_id, notes)
         VALUES ($1, 'hard_bounce', $2, $3, $4)
         ON CONFLICT (LOWER(email), COALESCE(practice_id, '00000000-0000-0000-0000-000000000000'::uuid))
         DO NOTHING`,
        [
          email.toLowerCase(),
          practiceId,
          sesMessageId,
          recipient.diagnosticCode ?? bounce.bounceSubType ?? null,
        ],
      )
      await pool.query(
        `UPDATE email_send_log
            SET status = 'bounced', error_message = $1
          WHERE ses_message_id = $2 AND LOWER(recipient_email) = LOWER($3)`,
        [recipient.diagnosticCode ?? 'hard_bounce', sesMessageId, email],
      )
      await auditSystemEvent({
        action: 'ses.bounce.hard',
        practiceId,
        severity: 'warning',
        details: {
          recipient: email,
          ses_message_id: sesMessageId,
          bounce_subtype: bounce.bounceSubType,
          diagnostic: recipient.diagnosticCode,
        },
        resourceType: 'ses_webhook',
      })
    } else {
      // Soft bounce — increment counter, alert at >=3 in 30d.
      await incrementSoftBounce(email, practiceId)
      await pool.query(
        `UPDATE email_send_log
            SET status = 'bounced', error_message = $1
          WHERE ses_message_id = $2 AND LOWER(recipient_email) = LOWER($3)`,
        [`soft:${recipient.diagnosticCode ?? bounce.bounceSubType ?? ''}`, sesMessageId, email],
      )
      await auditSystemEvent({
        action: 'ses.bounce.soft',
        practiceId,
        severity: 'warning',
        details: {
          recipient: email,
          ses_message_id: sesMessageId,
          bounce_subtype: bounce.bounceSubType,
          diagnostic: recipient.diagnosticCode,
        },
        resourceType: 'ses_webhook',
      })
    }
  }
}

async function handleComplaint(
  message: SesBounceMessage,
  sesMessageId: string,
  practiceId: string | null,
) {
  const complaint = message.complaint!
  for (const recipient of complaint.complainedRecipients) {
    const email = recipient.emailAddress
    await pool.query(
      `INSERT INTO ses_suppression_list (email, reason, practice_id, source_message_id, notes)
       VALUES ($1, 'complaint', $2, $3, $4)
       ON CONFLICT (LOWER(email), COALESCE(practice_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO NOTHING`,
      [
        email.toLowerCase(),
        practiceId,
        sesMessageId,
        complaint.complaintFeedbackType ?? null,
      ],
    )
    await pool.query(
      `UPDATE email_send_log
          SET status = 'complaint', error_message = $1
        WHERE ses_message_id = $2 AND LOWER(recipient_email) = LOWER($3)`,
      [complaint.complaintFeedbackType ?? 'complaint', sesMessageId, email],
    )
    await auditSystemEvent({
      action: 'ses.complaint',
      practiceId,
      severity: 'critical',
      details: {
        recipient: email,
        ses_message_id: sesMessageId,
        feedback_type: complaint.complaintFeedbackType,
      },
      resourceType: 'ses_webhook',
    })
  }
}

async function handleDelivery(
  message: SesBounceMessage,
  sesMessageId: string,
) {
  // Promote the log row from sent → delivered. Best-effort.
  for (const recipient of message.delivery!.recipients) {
    await pool.query(
      `UPDATE email_send_log
          SET status = 'delivered'
        WHERE ses_message_id = $1
          AND LOWER(recipient_email) = LOWER($2)
          AND status = 'sent'`,
      [sesMessageId, recipient],
    )
  }
}

const SOFT_BOUNCE_WINDOW_DAYS = 30
const SOFT_BOUNCE_THRESHOLD = 3

async function incrementSoftBounce(
  email: string,
  practiceId: string | null,
): Promise<void> {
  // Patients first (more common recipient).
  const r = await pool.query<{
    id: string
    practice_id: string
    soft_bounce_count: number
    soft_bounce_window_started_at: string | null
    target: 'patient' | 'user'
  }>(
    `WITH patient_match AS (
       SELECT id, practice_id, soft_bounce_count, soft_bounce_window_started_at,
              'patient'::text AS target
         FROM patients
        WHERE LOWER(email) = LOWER($1)
          AND ($2::uuid IS NULL OR practice_id = $2::uuid)
        LIMIT 1
     ),
     user_match AS (
       SELECT id, practice_id, soft_bounce_count, soft_bounce_window_started_at,
              'user'::text AS target
         FROM users
        WHERE LOWER(email) = LOWER($1)
          AND ($2::uuid IS NULL OR practice_id = $2::uuid)
          AND NOT EXISTS (SELECT 1 FROM patient_match)
        LIMIT 1
     )
     SELECT * FROM patient_match
     UNION ALL
     SELECT * FROM user_match`,
    [email, practiceId],
  )
  const row = r.rows[0]
  if (!row) return // recipient not on file — nothing to count

  // Re-anchor the window if older than 30 days.
  const now = new Date()
  let windowStart = row.soft_bounce_window_started_at
    ? new Date(row.soft_bounce_window_started_at)
    : null
  let count = row.soft_bounce_count ?? 0
  if (
    !windowStart ||
    (now.getTime() - windowStart.getTime()) / (1000 * 60 * 60 * 24) >
      SOFT_BOUNCE_WINDOW_DAYS
  ) {
    windowStart = now
    count = 1
  } else {
    count = count + 1
  }

  await pool.query(
    `UPDATE ${row.target === 'patient' ? 'patients' : 'users'}
        SET soft_bounce_count = $1,
            soft_bounce_window_started_at = $2
      WHERE id = $3`,
    [count, windowStart, row.id],
  )

  if (count >= SOFT_BOUNCE_THRESHOLD) {
    await alertPracticeOwner(row.practice_id, email, count)
  }
}

async function alertPracticeOwner(
  practiceId: string,
  recipientEmail: string,
  bounceCount: number,
): Promise<void> {
  try {
    const r = await pool.query<{ owner_email: string; name: string }>(
      `SELECT owner_email, name FROM practices WHERE id = $1`,
      [practiceId],
    )
    const practice = r.rows[0]
    if (!practice?.owner_email) return
    sendViaSes({
      to: practice.owner_email,
      subject: `Heads up — ${recipientEmail} has soft-bounced ${bounceCount} times`,
      html:
        `<p>Hi,</p>` +
        `<p>The email address <strong>${recipientEmail}</strong> has soft-bounced ${bounceCount} times in the past 30 days for ${practice.name}.</p>` +
        `<p>This usually means the recipient's mailbox is full or temporarily unreachable. If it doesn't recover in the next few days, you may want to reach out by phone or update their contact info.</p>` +
        `<p>— Harbor</p>`,
    }).catch(err => console.error('[ses-webhook] owner alert failed:', err.message))
    await auditSystemEvent({
      action: 'ses.bounce.soft.threshold_alerted',
      practiceId,
      severity: 'warning',
      details: { recipient: recipientEmail, bounce_count: bounceCount },
      resourceType: 'ses_webhook',
    })
  } catch (err) {
    console.error('[ses-webhook] alert practice owner failed:', (err as Error).message)
  }
}
