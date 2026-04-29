// lib/lead-webhooks.ts
//
// W51 D4 — fire reception lead webhook deliveries with HMAC signing
// and 3-retry exponential backoff. Best-effort: failures log + persist
// a row in lead_webhook_deliveries; never throws.

import { createHmac } from 'node:crypto'
import { pool } from '@/lib/aws/db'
import { decryptToken } from '@/lib/aws/token-encryption'

export type LeadWebhookEvent = 'lead.created' | 'lead.updated' | 'lead.exported'

interface LeadPayload {
  id: string
  practice_id: string
  status: string
  first_name: string | null
  last_name: string | null
  date_of_birth: string | null
  phone_e164: string | null
  email: string | null
  insurance_payer: string | null
  reason_for_visit: string | null
  urgency_level: string | null
  created_at: string
  updated_at: string
}

const RETRY_DELAYS_MS = [0, 30_000, 120_000] // ~now, +30s, +2m

export async function deliverLeadEvent(event: LeadWebhookEvent, lead: LeadPayload): Promise<void> {
  try {
    const cfgRow = await pool.query(
      `SELECT id, webhook_url, webhook_secret_encrypted, event_types, enabled
         FROM practice_lead_webhook_config
        WHERE practice_id = $1 LIMIT 1`,
      [lead.practice_id],
    )
    const cfg = cfgRow.rows[0]
    if (!cfg || !cfg.enabled) return
    const evt = (cfg.event_types as string[] | null) ?? []
    if (evt.length > 0 && !evt.includes(event)) return

    const secret = await decryptToken(cfg.webhook_secret_encrypted).catch(() => '')
    const body = JSON.stringify({
      event,
      delivered_at: new Date().toISOString(),
      lead,
    })

    void scheduleAttempt(cfg.id, lead.practice_id, lead.id, event, cfg.webhook_url, body, secret, 0)
  } catch (e) {
    console.error('[lead-webhooks] deliverLeadEvent setup failed:', (e as Error).message)
  }
}

async function scheduleAttempt(
  configId: string,
  practiceId: string,
  leadId: string,
  event: LeadWebhookEvent,
  url: string,
  body: string,
  secret: string,
  attemptIdx: number,
) {
  if (attemptIdx >= RETRY_DELAYS_MS.length) return
  const delay = RETRY_DELAYS_MS[attemptIdx]
  // We don't actually run a queue here — fire after delay if delay > 0.
  if (delay > 0) await new Promise(r => setTimeout(r, delay))

  const sig = createHmac('sha256', secret).update(body).digest('hex')
  let httpStatus = 0
  let responseExcerpt: string | null = null
  let failedReason: string | null = null
  let delivered = false

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-harbor-signature': `sha256=${sig}`,
        'x-harbor-event': event,
        'user-agent': 'harbor-lead-webhook/1',
      },
      body,
      // Cap the per-attempt time so a slow consumer can't pin a worker.
      signal: AbortSignal.timeout(8000),
    })
    httpStatus = res.status
    const text = await res.text().catch(() => '')
    responseExcerpt = text.slice(0, 500)
    delivered = res.ok
  } catch (err) {
    failedReason = (err as Error).message?.slice(0, 500) ?? 'unknown'
  }

  await pool.query(
    `INSERT INTO lead_webhook_deliveries
       (practice_id, config_id, lead_id, event_type, url, attempt,
        http_status, response_excerpt, delivered_at, failed_reason, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      practiceId, configId, leadId, event, url, attemptIdx + 1,
      httpStatus || null, responseExcerpt,
      delivered ? new Date() : null, failedReason,
      delivered ? null : (attemptIdx + 1 < RETRY_DELAYS_MS.length
        ? new Date(Date.now() + RETRY_DELAYS_MS[attemptIdx + 1])
        : null),
    ],
  ).catch((e) => console.error('[lead-webhooks] delivery log failed:', (e as Error).message))

  if (!delivered && attemptIdx + 1 < RETRY_DELAYS_MS.length) {
    void scheduleAttempt(configId, practiceId, leadId, event, url, body, secret, attemptIdx + 1)
  }
}
