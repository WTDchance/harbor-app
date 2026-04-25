// app/api/ehr/billing/stripe-webhook/route.ts
// Dedicated Stripe webhook for EHR patient invoices. Kept separate from
// Harbor's subscription webhook (/api/stripe/webhook) so subscription
// events and patient-invoice events don't cross wires.
//
// Hardened in week 7:
//   - Idempotency via ehr_processed_webhook_events. A replay (Stripe
//     retry, network dupe) returns 200 no-op.
//   - Per-event try/catch: failing handler returns 5xx for Stripe to
//     retry that specific event, but the idempotency row is only
//     written after a handler succeeds.
//   - Broader coverage: paid / payment_failed / payment_action_required
//     / voided / marked_uncollectible / finalized.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyWebhookSignature } from '@/lib/stripe'
import type Stripe from 'stripe'

const WEBHOOK_SECRET = process.env.STRIPE_EHR_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || ''

export async function POST(req: NextRequest) {
  if (!WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }
  const sig = req.headers.get('stripe-signature') || ''
  const raw = await req.text()

  let event: Stripe.Event
  try {
    event = verifyWebhookSignature(raw, sig, WEBHOOK_SECRET) as Stripe.Event
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Idempotency — already recorded? Short-circuit 200.
  try {
    const { data: existing } = await supabaseAdmin
      .from('ehr_processed_webhook_events')
      .select('event_id').eq('event_id', event.id).maybeSingle()
    if (existing) {
      return NextResponse.json({ received: true, idempotent_replay: true })
    }
  } catch (err) {
    console.error('[ehr/stripe-webhook] idempotency check failed', err)
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
        await handlePaymentActionRequired(event.data.object as Stripe.Invoice)
        break
      case 'invoice.voided':
      case 'invoice.marked_uncollectible':
        await handleInvoiceVoided(event.data.object as Stripe.Invoice)
        break
      case 'invoice.finalized':
        await handleInvoiceFinalized(event.data.object as Stripe.Invoice)
        break
      // Any other type — ignore silently.
    }

    // Record idempotency only after success.
    await supabaseAdmin.from('ehr_processed_webhook_events').insert({
      event_id: event.id,
      event_type: event.type,
      source: 'stripe',
    })

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[ehr/stripe-webhook] handler error', event.type, err)
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }
}

async function handleInvoicePaid(inv: Stripe.Invoice) {
  const { data: row } = await supabaseAdmin
    .from('ehr_invoices').select('id, practice_id, patient_id, charge_ids, total_cents, status')
    .eq('stripe_invoice_id', inv.id).maybeSingle()
  if (!row) return
  if (row.status === 'paid') return // defense against double-marking

  const amountPaid = Number(inv.amount_paid) || row.total_cents

  await supabaseAdmin
    .from('ehr_invoices')
    .update({ status: 'paid', paid_cents: amountPaid, paid_at: new Date().toISOString() })
    .eq('id', row.id)

  await supabaseAdmin.from('ehr_payments').insert({
    practice_id: row.practice_id,
    patient_id: row.patient_id,
    source: 'patient_stripe',
    amount_cents: amountPaid,
    stripe_payment_intent_id: (inv.payment_intent as string) || null,
    note: `Stripe invoice ${inv.id}`,
  })

  if (row.charge_ids && row.charge_ids.length > 0) {
    await supabaseAdmin
      .from('ehr_charges')
      .update({ status: 'paid' })
      .in('id', row.charge_ids)
      .eq('practice_id', row.practice_id)
  }
}

async function handleInvoiceFinalized(inv: Stripe.Invoice) {
  if (!inv.hosted_invoice_url) return
  await supabaseAdmin
    .from('ehr_invoices')
    .update({ stripe_payment_url: inv.hosted_invoice_url })
    .eq('stripe_invoice_id', inv.id)
    .is('stripe_payment_url', null)
}

async function handlePaymentFailed(inv: Stripe.Invoice) {
  await auditSystem(inv.id, 'invoice_payment_failed', 'warn')
}

async function handlePaymentActionRequired(inv: Stripe.Invoice) {
  await auditSystem(inv.id, 'invoice_payment_action_required', 'warn')
}

async function handleInvoiceVoided(inv: Stripe.Invoice) {
  await supabaseAdmin
    .from('ehr_invoices')
    .update({ status: 'void' })
    .eq('stripe_invoice_id', inv.id)
}

async function auditSystem(invoiceId: string | null, kind: string, severity: 'warn' | 'info' | 'error') {
  if (!invoiceId) return
  const { data: row } = await supabaseAdmin
    .from('ehr_invoices').select('id, practice_id').eq('stripe_invoice_id', invoiceId).maybeSingle()
  if (!row) return
  await supabaseAdmin.from('audit_logs').insert({
    practice_id: row.practice_id,
    user_id: '00000000-0000-0000-0000-000000000000',
    user_email: 'stripe-webhook',
    action: 'note.update',
    resource_type: 'ehr_progress_note',
    resource_id: row.id,
    details: { kind, stripe_invoice_id: invoiceId },
    severity,
  })
}
