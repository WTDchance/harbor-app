// Patient-invoice Stripe webhook (separate from /api/stripe/webhook so
// subscription events and patient-invoice events don't cross wires).
//
// Idempotency: ehr_processed_webhook_events row is INSERTed only AFTER
// a successful handler. Stripe replays return 200 no-op via the lookup.
//
// Webhook secret precedence:
//   STRIPE_EHR_WEBHOOK_SECRET  (preferred — dedicated EHR endpoint secret)
//   STRIPE_WEBHOOK_SECRET      (legacy fallback)

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { verifyWebhookSignature } from '@/lib/stripe'
import type Stripe from 'stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WEBHOOK_SECRET =
  process.env.STRIPE_EHR_WEBHOOK_SECRET ||
  process.env.STRIPE_WEBHOOK_SECRET || ''

export async function POST(req: NextRequest) {
  if (!WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }
  const sig = req.headers.get('stripe-signature') || ''
  const raw = await req.text()

  let event: Stripe.Event
  try {
    const verified = verifyWebhookSignature(raw, sig, WEBHOOK_SECRET)
    if (!verified) throw new Error('verifyWebhookSignature returned null')
    event = verified
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Idempotency check.
  try {
    const { rows } = await pool.query(
      `SELECT event_id FROM ehr_processed_webhook_events
        WHERE event_id = $1 LIMIT 1`,
      [event.id],
    )
    if (rows[0]) {
      return NextResponse.json({ received: true, idempotent_replay: true })
    }
  } catch (err) {
    console.error('[ehr/stripe-webhook] idempotency check failed:', (err as Error).message)
    // Fall through — better to risk a duplicate than drop a payment event.
  }

  try {
    switch (event.type) {
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice)
        break
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice)
        break
      case 'invoice.payment_action_required':
        await handleActionRequired(event.data.object as Stripe.Invoice)
        break
      case 'invoice.voided':
      case 'invoice.marked_uncollectible':
        await handleInvoiceVoided(event.data.object as Stripe.Invoice)
        break
      case 'invoice.finalized':
        await handleInvoiceFinalized(event.data.object as Stripe.Invoice)
        break
      // Other event types — ignore.
    }

    await pool.query(
      `INSERT INTO ehr_processed_webhook_events (event_id, event_type, source)
       VALUES ($1, $2, 'stripe')`,
      [event.id, event.type],
    ).catch(err => console.error('[ehr/stripe-webhook] idempotency insert failed:', err.message))

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[ehr/stripe-webhook] handler error', event.type, err)
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }
}

async function handleInvoicePaid(inv: Stripe.Invoice): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id, practice_id, patient_id, charge_ids, total_cents, status
       FROM ehr_invoices WHERE stripe_invoice_id = $1 LIMIT 1`,
    [inv.id],
  )
  const row = rows[0]
  if (!row) return
  if (row.status === 'paid') return // defense against double-marking

  const amountPaid = Number(inv.amount_paid) || row.total_cents
  const paymentIntentId = (inv.payment_intent as string) || null

  // Two writes (invoice update + payment insert) + optional charge updates.
  // Wrap in a transaction.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `UPDATE ehr_invoices
          SET status = 'paid', paid_cents = $1, paid_at = NOW(),
              updated_at = NOW()
        WHERE id = $2`,
      [amountPaid, row.id],
    )

    await client.query(
      `INSERT INTO ehr_payments (
         practice_id, patient_id, source, amount_cents,
         stripe_payment_intent_id, note
       ) VALUES (
         $1, $2, 'patient_stripe', $3, $4, $5
       )`,
      [row.practice_id, row.patient_id, amountPaid, paymentIntentId,
       `Stripe invoice ${inv.id}`],
    )

    if (Array.isArray(row.charge_ids) && row.charge_ids.length > 0) {
      await client.query(
        `UPDATE ehr_charges
            SET status = 'paid', updated_at = NOW()
          WHERE id = ANY($1::uuid[]) AND practice_id = $2`,
        [row.charge_ids, row.practice_id],
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  await auditPracticeEvent(row.practice_id, 'billing.invoice.paid', {
    stripe_invoice_id: inv.id, amount_cents: amountPaid,
  })
}

async function handleInvoiceFinalized(inv: Stripe.Invoice): Promise<void> {
  if (!inv.hosted_invoice_url) return
  await pool.query(
    `UPDATE ehr_invoices
        SET stripe_payment_url = $1, updated_at = NOW()
      WHERE stripe_invoice_id = $2 AND stripe_payment_url IS NULL`,
    [inv.hosted_invoice_url, inv.id],
  )
  const { rows } = await pool.query(
    `SELECT practice_id FROM ehr_invoices WHERE stripe_invoice_id = $1 LIMIT 1`,
    [inv.id],
  ).catch(() => ({ rows: [] as any[] }))
  if (rows[0]) {
    await auditPracticeEvent(rows[0].practice_id, 'billing.invoice.finalized', {
      stripe_invoice_id: inv.id,
    })
  }
}

async function handlePaymentFailed(inv: Stripe.Invoice): Promise<void> {
  await auditByInvoice(inv.id, 'billing.invoice.failed', 'warn')
}

async function handleActionRequired(inv: Stripe.Invoice): Promise<void> {
  await auditByInvoice(inv.id, 'billing.invoice.action_required', 'warn')
}

async function handleInvoiceVoided(inv: Stripe.Invoice): Promise<void> {
  await pool.query(
    `UPDATE ehr_invoices
        SET status = 'void', updated_at = NOW()
      WHERE stripe_invoice_id = $1`,
    [inv.id],
  )
  await auditByInvoice(inv.id, 'billing.invoice.voided', 'warn')
}

async function auditByInvoice(
  invoiceId: string | null,
  action: string,
  severity: 'info' | 'warn' | 'error' = 'info',
): Promise<void> {
  if (!invoiceId) return
  const { rows } = await pool.query(
    `SELECT id, practice_id FROM ehr_invoices
      WHERE stripe_invoice_id = $1 LIMIT 1`,
    [invoiceId],
  ).catch(() => ({ rows: [] as any[] }))
  if (!rows[0]) return
  await auditPracticeEvent(rows[0].practice_id, action, {
    stripe_invoice_id: invoiceId,
    ehr_invoice_id: rows[0].id,
  }, severity)
}

async function auditPracticeEvent(
  practiceId: string,
  action: string,
  details: Record<string, unknown>,
  severity: 'info' | 'warn' | 'error' = 'info',
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_logs (
       user_id, user_email, practice_id, action,
       resource_type, resource_id, details, severity
     ) VALUES (NULL, 'stripe-webhook', $1, $2, 'ehr_invoice', NULL, $3::jsonb, $4)`,
    [practiceId, action, JSON.stringify(details), severity],
  ).catch(() => {})
}
