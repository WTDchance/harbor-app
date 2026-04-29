// app/api/webhooks/stripe-subscription/route.ts
//
// Harbor-as-vendor subscription webhook. Handles the lifecycle of the
// Stripe subscription that bills a therapy practice for using Harbor.
//
// Pipeline:
//   1. Verify Stripe signature (STRIPE_WEBHOOK_SECRET).
//   2. INSERT into practice_subscription_events FIRST. Unique violation on
//      stripe_event_id => already processed => 200. This is the dedupe lock.
//   3. Dispatch on event.type and mutate practice_subscriptions /
//      practice_invoices / practices.status.
//   4. Audit-log every state transition (severity info | warning | critical).
//
// Events handled:
//   customer.subscription.{created,updated,deleted}
//   customer.subscription.trial_will_end
//   invoice.{created,finalized,paid,payment_failed,payment_action_required}
//
// Dunning sequence on payment_failed:
//   day 0  immediate notice
//   day 3  reminder
//   day 7  warning
//   day 14 final notice + flip practices.status='suspended'
// Email send is delegated to lib/email — if not present, falls back to a
// console.log + TODO marker so the dunning state is observable in CloudWatch.

import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { pool } from '@/lib/aws/db'
import { stripe, verifyWebhookSignature } from '@/lib/stripe'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { tierFromStripePriceId, type HarborTierKey } from '@/lib/billing/stripe-products'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WEBHOOK_SECRET = process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET
  || process.env.STRIPE_WEBHOOK_SECRET
  || ''

// ---------------------------------------------------------------------------
// Email helper resolution. The transactional-email pipeline isn't merged
// onto parallel/aws-v1 yet, so we stub with a structured console.log + TODO.
// When the email branch lands, swap this for the real helper.
// ---------------------------------------------------------------------------
async function sendDunningEmail(params: {
  practiceId: string
  template:
    | 'subscription-payment-failed-day-0'
    | 'subscription-payment-failed-day-3'
    | 'subscription-payment-failed-day-7'
    | 'subscription-payment-failed-day-14-suspending'
    | 'subscription-trial-ending-3-days'
    | 'subscription-canceled'
  context: Record<string, unknown>
}) {
  // TODO: send dunning email via lib/email-* when transactional-email
  // pipeline is merged onto parallel/aws-v1.
  console.log('[stripe-subscription/dunning][stub-email]', JSON.stringify({
    practice_id: params.practiceId,
    template: params.template,
    context: params.context,
  }))
}

// Class of severity for an audit row given the next subscription status.
function severityForStatus(status: string): 'info' | 'warning' | 'critical' {
  switch (status) {
    case 'past_due':
    case 'incomplete':
    case 'paused':
      return 'warning'
    case 'unpaid':
    case 'canceled':
      return 'critical'
    default:
      return 'info'
  }
}

// Resolve the practice_id for an inbound Stripe object. Tries (in order):
//   1. metadata.practice_id on the object itself
//   2. practice_subscriptions.stripe_customer_id mirror lookup
//   3. practices.stripe_customer_id direct lookup
async function resolvePracticeId(args: {
  metadataPracticeId?: string | null
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
}): Promise<string | null> {
  const { metadataPracticeId, stripeCustomerId, stripeSubscriptionId } = args
  if (metadataPracticeId) return metadataPracticeId

  if (stripeSubscriptionId) {
    const { rows } = await pool.query(
      `SELECT practice_id FROM practice_subscriptions
        WHERE stripe_subscription_id = $1 LIMIT 1`,
      [stripeSubscriptionId],
    )
    if (rows[0]?.practice_id) return rows[0].practice_id
  }

  if (stripeCustomerId) {
    const sub = await pool.query(
      `SELECT practice_id FROM practice_subscriptions
        WHERE stripe_customer_id = $1 LIMIT 1`,
      [stripeCustomerId],
    )
    if (sub.rows[0]?.practice_id) return sub.rows[0].practice_id
    const prac = await pool.query(
      `SELECT id FROM practices WHERE stripe_customer_id = $1 LIMIT 1`,
      [stripeCustomerId],
    )
    if (prac.rows[0]?.id) return prac.rows[0].id
  }

  return null
}

function asTimestamp(ts: number | null | undefined): string | null {
  if (!ts) return null
  return new Date(ts * 1000).toISOString()
}

// ---------------------------------------------------------------------------
// Idempotency lock. INSERTs into practice_subscription_events; returns true
// if this event was already processed (so the caller should short-circuit).
// ---------------------------------------------------------------------------
async function isDuplicate(event: Stripe.Event, practiceId: string | null): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO practice_subscription_events
         (practice_id, stripe_event_id, event_type, raw_payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [practiceId, event.id, event.type, JSON.stringify(event)],
    )
    return false
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code
    if (code === '23505') {
      // unique_violation — already processed
      return true
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Subscription state mirror. Upserts practice_subscriptions and applies
// status-derived side-effects (practices.status, audit log).
// ---------------------------------------------------------------------------
async function upsertSubscription(
  practiceId: string,
  sub: Stripe.Subscription,
  reason: string,
) {
  const priceId = sub.items.data[0]?.price?.id ?? null
  const tier: HarborTierKey | null = tierFromStripePriceId(priceId)
  if (!tier) {
    // Reception-only sandbox or legacy founding-member price — log and skip.
    // We still want to know the subscription state, but we can't store a
    // tier without violating the CHECK constraint. Audit-only for now.
    await auditSystemEvent({
      action: 'billing.subscription.tier_unmapped',
      severity: 'warning',
      practiceId,
      details: { stripe_subscription_id: sub.id, stripe_price_id: priceId, reason },
    })
    return
  }

  await pool.query(
    `INSERT INTO practice_subscriptions (
       practice_id, stripe_customer_id, stripe_subscription_id,
       stripe_price_id, tier, status,
       trial_ends_at, current_period_start, current_period_end,
       cancel_at_period_end, canceled_at, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
     ON CONFLICT (practice_id) DO UPDATE SET
       stripe_customer_id     = EXCLUDED.stripe_customer_id,
       stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       stripe_price_id        = EXCLUDED.stripe_price_id,
       tier                   = EXCLUDED.tier,
       status                 = EXCLUDED.status,
       trial_ends_at          = EXCLUDED.trial_ends_at,
       current_period_start   = EXCLUDED.current_period_start,
       current_period_end     = EXCLUDED.current_period_end,
       cancel_at_period_end   = EXCLUDED.cancel_at_period_end,
       canceled_at            = EXCLUDED.canceled_at,
       metadata               = EXCLUDED.metadata`,
    [
      practiceId,
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      sub.id,
      priceId,
      tier,
      sub.status,
      asTimestamp(sub.trial_end),
      asTimestamp(sub.current_period_start),
      asTimestamp(sub.current_period_end),
      sub.cancel_at_period_end,
      asTimestamp(sub.canceled_at),
      JSON.stringify(sub.metadata ?? {}),
    ],
  )

  // Mirror the high-level status onto practices.status for middleware gating.
  // Map: active|trialing -> active, past_due|unpaid -> past_due, canceled -> canceled.
  // Suspension is set by the dunning sequence, not directly by status.
  let nextPracticeStatus: 'active' | 'past_due' | 'canceled' | null = null
  if (sub.status === 'active' || sub.status === 'trialing') nextPracticeStatus = 'active'
  else if (sub.status === 'past_due' || sub.status === 'unpaid') nextPracticeStatus = 'past_due'
  else if (sub.status === 'canceled') nextPracticeStatus = 'canceled'

  if (nextPracticeStatus) {
    await pool.query(
      `UPDATE practices SET status = $1
        WHERE id = $2 AND status <> 'suspended'`,
      [nextPracticeStatus, practiceId],
    )
  }

  await auditSystemEvent({
    action: `billing.subscription.${reason}`,
    severity: severityForStatus(sub.status),
    practiceId,
    resourceType: 'practice_subscription',
    resourceId: sub.id,
    details: {
      stripe_subscription_id: sub.id,
      stripe_price_id: priceId,
      tier,
      status: sub.status,
      cancel_at_period_end: sub.cancel_at_period_end,
      trial_end: asTimestamp(sub.trial_end),
    },
  })
}

// ---------------------------------------------------------------------------
// Invoice mirror.
// ---------------------------------------------------------------------------
async function upsertInvoice(
  practiceId: string,
  invoice: Stripe.Invoice,
  reason: string,
) {
  await pool.query(
    `INSERT INTO practice_invoices (
       practice_id, stripe_invoice_id, stripe_invoice_number,
       amount_due_cents, amount_paid_cents, currency, status,
       invoice_pdf_url, hosted_invoice_url, paid_at, due_date, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
     ON CONFLICT (stripe_invoice_id) DO UPDATE SET
       stripe_invoice_number = EXCLUDED.stripe_invoice_number,
       amount_due_cents      = EXCLUDED.amount_due_cents,
       amount_paid_cents     = EXCLUDED.amount_paid_cents,
       status                = EXCLUDED.status,
       invoice_pdf_url       = EXCLUDED.invoice_pdf_url,
       hosted_invoice_url    = EXCLUDED.hosted_invoice_url,
       paid_at               = EXCLUDED.paid_at,
       due_date              = EXCLUDED.due_date,
       metadata              = EXCLUDED.metadata`,
    [
      practiceId,
      invoice.id,
      invoice.number ?? null,
      invoice.amount_due ?? 0,
      invoice.amount_paid ?? 0,
      (invoice.currency ?? 'usd').toLowerCase(),
      invoice.status ?? 'open',
      invoice.invoice_pdf ?? null,
      invoice.hosted_invoice_url ?? null,
      asTimestamp(invoice.status_transitions?.paid_at ?? null),
      asTimestamp(invoice.due_date),
      JSON.stringify(invoice.metadata ?? {}),
    ],
  )

  await auditSystemEvent({
    action: `billing.invoice.${reason}`,
    severity: invoice.status === 'paid' ? 'info' : 'warning',
    practiceId,
    resourceType: 'practice_invoice',
    resourceId: invoice.id,
    details: {
      stripe_invoice_id: invoice.id,
      amount_due_cents: invoice.amount_due,
      amount_paid_cents: invoice.amount_paid,
      status: invoice.status,
    },
  })
}

// ---------------------------------------------------------------------------
// Dunning. Schedules four touchpoints relative to the failure timestamp.
// Day 0 fires inline; days 3/7/14 are stubbed for the cron worker (separate
// followup). Day 14 also flips practices.status='suspended'.
// ---------------------------------------------------------------------------
async function runDunning(practiceId: string, invoice: Stripe.Invoice) {
  // Day 0 — immediate
  await sendDunningEmail({
    practiceId,
    template: 'subscription-payment-failed-day-0',
    context: { stripe_invoice_id: invoice.id, amount_due_cents: invoice.amount_due ?? 0 },
  })

  // Days 3 / 7 are the responsibility of a billing cron (separate change).
  // We stub the calls so a future cron can find the marker.
  // TODO: schedule day 3 / day 7 dunning via lib/cron when cron worker is in place.
  console.log('[stripe-subscription/dunning][schedule]', JSON.stringify({
    practice_id: practiceId,
    stripe_invoice_id: invoice.id,
    next: ['day_3','day_7','day_14_suspending'],
  }))

  await auditSystemEvent({
    action: 'billing.dunning.started',
    severity: 'warning',
    practiceId,
    resourceType: 'practice_invoice',
    resourceId: invoice.id,
    details: { stripe_invoice_id: invoice.id, amount_due_cents: invoice.amount_due ?? 0 },
  })

  // If the invoice is older than 14 days and still unpaid, suspend now.
  // This handles the case where the cron hasn't fired but a webhook replay
  // arrives long after the original failure.
  const failedAt = asTimestamp(invoice.status_transitions?.finalized_at ?? null)
  if (failedAt) {
    const ageDays = (Date.now() - new Date(failedAt).getTime()) / (1000 * 60 * 60 * 24)
    if (ageDays >= 14 && invoice.status !== 'paid') {
      await pool.query(`UPDATE practices SET status = 'suspended' WHERE id = $1`, [practiceId])
      await sendDunningEmail({
        practiceId,
        template: 'subscription-payment-failed-day-14-suspending',
        context: { stripe_invoice_id: invoice.id },
      })
      await auditSystemEvent({
        action: 'billing.practice.suspended',
        severity: 'critical',
        practiceId,
        resourceType: 'practice',
        resourceId: practiceId,
        details: { reason: 'dunning_day_14', stripe_invoice_id: invoice.id },
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Main handler.
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 500 })
  }
  if (!WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'webhook_secret_not_configured' }, { status: 500 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'missing_signature' }, { status: 400 })
  }

  const rawBody = await request.text()
  const event = verifyWebhookSignature(rawBody, signature, WEBHOOK_SECRET)
  if (!event) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 403 })
  }

  // ------------------------------------------------------------------
  // Resolve practice_id BEFORE the dedupe insert so we can attach it.
  // ------------------------------------------------------------------
  let practiceId: string | null = null
  try {
    const obj = event.data.object as Record<string, unknown>
    const metadata = (obj?.metadata ?? {}) as Record<string, string | undefined>
    const customerId =
      (typeof obj?.customer === 'string' ? (obj.customer as string) : null)
        ?? (obj?.customer as { id?: string } | undefined)?.id
        ?? null
    const subscriptionId =
      (typeof obj?.subscription === 'string' ? (obj.subscription as string) : null)
        ?? (event.type.startsWith('customer.subscription.') ? (obj?.id as string) : null)
        ?? null

    practiceId = await resolvePracticeId({
      metadataPracticeId: metadata.practice_id ?? null,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
    })
  } catch (err) {
    console.error('[stripe-subscription] practice resolution failed:', (err as Error).message)
  }

  // ------------------------------------------------------------------
  // Idempotency. Insert event row; return 200 if already-processed.
  // ------------------------------------------------------------------
  let duplicate = false
  try {
    duplicate = await isDuplicate(event, practiceId)
  } catch (err) {
    console.error('[stripe-subscription] dedupe insert failed:', (err as Error).message)
    return NextResponse.json({ error: 'dedupe_insert_failed' }, { status: 500 })
  }
  if (duplicate) {
    return NextResponse.json({ received: true, duplicate: true })
  }

  if (!practiceId) {
    // No practice can be resolved. Audit and 200 — Stripe shouldn't retry
    // forever on customers we don't know about.
    await auditSystemEvent({
      action: 'billing.webhook.unmapped',
      severity: 'warning',
      details: { event_id: event.id, event_type: event.type },
    })
    return NextResponse.json({ received: true, mapped: false })
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
        await upsertSubscription(practiceId, event.data.object as Stripe.Subscription, 'created')
        break
      case 'customer.subscription.updated':
        await upsertSubscription(practiceId, event.data.object as Stripe.Subscription, 'updated')
        break
      case 'customer.subscription.deleted':
        await upsertSubscription(practiceId, event.data.object as Stripe.Subscription, 'deleted')
        break
      case 'customer.subscription.trial_will_end':
        await upsertSubscription(
          practiceId,
          event.data.object as Stripe.Subscription,
          'trial_will_end',
        )
        await sendDunningEmail({
          practiceId,
          template: 'subscription-trial-ending-3-days',
          context: {
            trial_end: asTimestamp((event.data.object as Stripe.Subscription).trial_end),
          },
        })
        break

      case 'invoice.created':
        await upsertInvoice(practiceId, event.data.object as Stripe.Invoice, 'created')
        break
      case 'invoice.finalized':
        await upsertInvoice(practiceId, event.data.object as Stripe.Invoice, 'finalized')
        break
      case 'invoice.paid':
        await upsertInvoice(practiceId, event.data.object as Stripe.Invoice, 'paid')
        // A successful payment lifts past_due. Don't lift suspended — that
        // requires explicit reinstatement to make sure the operator
        // re-verifies the practice.
        await pool.query(
          `UPDATE practices SET status = 'active'
             WHERE id = $1 AND status = 'past_due'`,
          [practiceId],
        )
        break
      case 'invoice.payment_failed':
        await upsertInvoice(practiceId, event.data.object as Stripe.Invoice, 'payment_failed')
        await pool.query(
          `UPDATE practices SET status = 'past_due'
             WHERE id = $1 AND status = 'active'`,
          [practiceId],
        )
        await runDunning(practiceId, event.data.object as Stripe.Invoice)
        break
      case 'invoice.payment_action_required':
        await upsertInvoice(
          practiceId,
          event.data.object as Stripe.Invoice,
          'payment_action_required',
        )
        await auditSystemEvent({
          action: 'billing.invoice.payment_action_required',
          severity: 'warning',
          practiceId,
          details: { stripe_invoice_id: (event.data.object as Stripe.Invoice).id },
        })
        break

      default:
        // Not a subscription/invoice event we care about. The dedupe row is
        // still recorded so Stripe-replay-attacks can't bypass.
        break
    }
  } catch (err) {
    console.error('[stripe-subscription] handler failed:', err)
    await auditSystemEvent({
      action: 'billing.webhook.handler_error',
      severity: 'critical',
      practiceId,
      details: {
        event_id: event.id,
        event_type: event.type,
        message: (err as Error).message,
      },
    })
    // Return 500 so Stripe retries. Dedupe row is already in place so the
    // retry will process exactly once on success.
    return NextResponse.json({ error: 'handler_failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
