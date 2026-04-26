// Harbor — Stripe webhook (subscriptions + provisioning).
//
// Handles:
//   - checkout.session.completed       — new practice paid; provisioning trigger
//   - customer.subscription.created    — sub state sync
//   - customer.subscription.updated    — sub state sync
//   - customer.subscription.deleted    — sub state sync
//   - invoice.payment_succeeded        — log
//   - invoice.payment_failed           — flip practice to past_due
//
// CARRIER-PROVISIONING CARVE: legacy handleCheckoutCompleted called
// purchaseTwilioNumber + createVapiAssistant + linkVapiPhoneNumber. Those
// are Bucket 1 (carrier swap → SignalWire/Retell). On AWS today the
// checkout handler:
//   * loads + idempotency-checks the practice row
//   * marks the practice as paid (subscription + customer ids stamped)
//   * stamps stripe_subscription_id / stripe_customer_id
//   * skips actual phone+assistant provisioning with a clearly logged TODO
//   * sends the welcome email via SES (Wave 5) WITHOUT a phone number
// This means a card-upfront signup leaves the practice in
// status='active' but without a phone provisioned. Existing dashboard
// signups (the path Chance's first customer uses) bypass this whole
// flow — they aren't blocked.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { verifyWebhookSignature } from '@/lib/stripe'
import { sendWelcomeEmail } from '@/lib/email-welcome'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || ''

async function auditEvent(
  practiceId: string | null, action: string,
  details: Record<string, unknown>, severity: 'info' | 'warn' | 'error' = 'info',
) {
  await pool.query(
    `INSERT INTO audit_logs (
       user_id, user_email, practice_id, action,
       resource_type, resource_id, details, severity
     ) VALUES (NULL, 'stripe-webhook', $1, $2, 'stripe_event', NULL, $3::jsonb, $4)`,
    [practiceId, action, JSON.stringify(details), severity],
  ).catch(() => {})
}

export async function POST(request: NextRequest) {
  if (!webhookSecret) {
    return NextResponse.json({ error: 'STRIPE_WEBHOOK_SECRET not configured' }, { status: 500 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 })
  }

  const body = await request.text()
  const event = verifyWebhookSignature(body, signature, webhookSecret)
  if (!event) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  console.log(`[stripe/webhook] ${event.type}`)

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as any)
        break
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object as any)
        break
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as any)
        break
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as any)
        break
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object as any)
        break
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as any)
        break
      // Other event types: silently ignored.
    }
    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[stripe/webhook] handler error:', err)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

async function handleCheckoutCompleted(session: any): Promise<void> {
  const sessionId = session.id as string
  const customerId = session.customer as string | null
  const subscriptionId = session.subscription as string | null
  const metadata = session.metadata || {}
  const practiceId = metadata.practice_id as string | undefined

  if (!practiceId) {
    console.warn(`[stripe/webhook] checkout.session.completed without practice_id (${sessionId})`)
    return
  }

  // Practice is the source of truth for idempotency.
  const { rows } = await pool.query(
    `SELECT id, name, owner_email, provisioning_state, vapi_assistant_id,
            twilio_phone_number, stripe_customer_id, founding_member
       FROM practices WHERE id = $1 LIMIT 1`,
    [practiceId],
  )
  const practice = rows[0]
  if (!practice) {
    console.error(`[stripe/webhook] practice ${practiceId} not found`)
    return
  }
  if (practice.provisioning_state === 'active' && practice.vapi_assistant_id && practice.twilio_phone_number) {
    console.log(`[stripe/webhook] practice ${practiceId} already provisioned — skipping`)
    return
  }

  // Stamp the billing side. AWS canonical fields: provisioning_state,
  // stripe_customer_id, stripe_subscription_id.
  await pool.query(
    `UPDATE practices
        SET provisioning_state = 'active',
            stripe_customer_id = COALESCE(stripe_customer_id, $1),
            stripe_subscription_id = COALESCE(stripe_subscription_id, $2),
            updated_at = NOW()
      WHERE id = $3`,
    [customerId, subscriptionId, practiceId],
  ).catch(err => {
    console.error('[stripe/webhook] practice update failed:', err.message)
  })

  // TODO(bucket-1 — SignalWire/Retell carrier swap):
  //   * purchase phone number via SignalWire (replaces purchaseTwilioNumber)
  //   * create Retell agent (replaces createVapiAssistant)
  //   * link the number to the agent (replaces linkVapiPhoneNumber)
  // Until that wave lands, practices that come through the card-upfront
  // checkout flow land in status='active' but without a phone number.
  // Dashboard-side signups that don't trigger this webhook aren't affected.
  console.warn(`[stripe/webhook] CARRIER PROVISIONING SKIPPED (Bucket 1) for practice ${practiceId}`)

  // Welcome email — SES via Wave 5. owner_email is canonical.
  if (practice.owner_email) {
    try {
      await sendWelcomeEmail({
        to: practice.owner_email,
        practiceName: practice.name,
        aiName: 'Ellie',
        phoneNumber: 'pending — your phone line will be activated shortly',
        foundingMember: !!practice.founding_member,
      })
    } catch (err) {
      console.error('[stripe/webhook] welcome email failed:', (err as Error).message)
    }
  }

  await auditEvent(practiceId, 'provision.checkout_completed', {
    session_id: sessionId,
    customer_id: customerId,
    subscription_id: subscriptionId,
    carrier_provisioning: 'deferred_bucket_1',
  }, 'warn')
}

async function handleSubscriptionCreated(subscription: any): Promise<void> {
  const customerId = subscription.customer
  const subscriptionId = subscription.id
  const status = subscription.status

  const { rows } = await pool.query(
    `SELECT id FROM practices WHERE stripe_customer_id = $1 LIMIT 1`,
    [customerId],
  ).catch(() => ({ rows: [] as any[] }))
  const practice = rows[0]
  if (!practice) {
    console.warn('[stripe/webhook] subscription.created — no practice for customer', customerId)
    return
  }

  await pool.query(
    `UPDATE practices
        SET stripe_subscription_id = $1,
            updated_at = NOW()
      WHERE id = $2`,
    [subscriptionId, practice.id],
  )

  await auditEvent(practice.id, 'billing.subscription.created', {
    subscription_id: subscriptionId, status,
  })
}

async function handleSubscriptionUpdated(subscription: any): Promise<void> {
  const customerId = subscription.customer
  const subscriptionId = subscription.id
  const status = subscription.status

  const { rows } = await pool.query(
    `SELECT id FROM practices WHERE stripe_customer_id = $1 LIMIT 1`,
    [customerId],
  ).catch(() => ({ rows: [] as any[] }))
  const practice = rows[0]
  if (!practice) return

  await auditEvent(practice.id, 'billing.subscription.updated', {
    subscription_id: subscriptionId, status,
  })
}

async function handleSubscriptionDeleted(subscription: any): Promise<void> {
  const customerId = subscription.customer
  const subscriptionId = subscription.id

  const { rows } = await pool.query(
    `SELECT id FROM practices WHERE stripe_customer_id = $1 LIMIT 1`,
    [customerId],
  ).catch(() => ({ rows: [] as any[] }))
  const practice = rows[0]
  if (!practice) return

  await pool.query(
    `UPDATE practices
        SET provisioning_state = 'cancelled',
            updated_at = NOW()
      WHERE id = $1`,
    [practice.id],
  )

  await auditEvent(practice.id, 'billing.subscription.cancelled', {
    subscription_id: subscriptionId,
  }, 'warn')
}

async function handlePaymentSucceeded(invoice: any): Promise<void> {
  console.log(`[stripe/webhook] payment succeeded: ${invoice.id}`)
}

async function handlePaymentFailed(invoice: any): Promise<void> {
  const customerId = invoice.customer
  const subscriptionId = invoice.subscription

  const { rows } = await pool.query(
    `SELECT id FROM practices WHERE stripe_customer_id = $1 LIMIT 1`,
    [customerId],
  ).catch(() => ({ rows: [] as any[] }))
  const practice = rows[0]
  if (!practice || !subscriptionId) return

  // AWS canonical doesn't have subscription_status as a separate column —
  // we surface past-due via audit + the existing provisioning_state stays
  // intact. (Legacy flipped subscription_status='past_due'; on AWS this
  // is captured in the audit trail until a dedicated column lands.)
  await auditEvent(practice.id, 'billing.payment.failed', {
    invoice_id: invoice.id, subscription_id: subscriptionId,
  }, 'warn')

  console.warn(`[stripe/webhook] payment failed for invoice ${invoice.id}, audit-logged`)
}
