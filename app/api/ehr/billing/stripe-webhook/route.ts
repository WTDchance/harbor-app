// app/api/ehr/billing/stripe-webhook/route.ts
// Dedicated Stripe webhook for EHR patient invoices. Kept separate from
// Harbor's subscription webhook (/api/stripe/webhook) so subscription
// events and patient-invoice events don't cross wires.
//
// Events handled:
//   invoice.paid                 → mark ehr_invoices as paid, insert ehr_payments,
//                                   update linked ehr_charges
//   invoice.payment_failed       → mark ehr_invoices.status = sent (unchanged),
//                                   audit for admin visibility
//   invoice.voided               → ehr_invoices.status = void

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { stripe, verifyWebhookSignature } from '@/lib/stripe'
import type Stripe from 'stripe'

// Use a dedicated webhook secret so rotating the subscription webhook
// doesn't break patient invoicing.
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

  try {
    if (event.type === 'invoice.paid') {
      await handleInvoicePaid(event.data.object as Stripe.Invoice)
    } else if (event.type === 'invoice.payment_failed') {
      await handlePaymentFailed(event.data.object as Stripe.Invoice)
    } else if (event.type === 'invoice.voided' || event.type === 'invoice.marked_uncollectible') {
      await handleInvoiceVoided(event.data.object as Stripe.Invoice)
    }
    // Other event types: ignore silently.
    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[ehr/stripe-webhook] handler error', err)
    // Return 500 so Stripe retries. We never acknowledge a failed handler.
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }
}

async function handleInvoicePaid(inv: Stripe.Invoice) {
  // Find our row
  const { data: row } = await supabaseAdmin
    .from('ehr_invoices').select('id, practice_id, patient_id, charge_ids, total_cents')
    .eq('stripe_invoice_id', inv.id).maybeSingle()
  if (!row) return // not one of ours

  const amountPaid = Number(inv.amount_paid) || row.total_cents

  // Update invoice
  await supabaseAdmin
    .from('ehr_invoices')
    .update({
      status: 'paid',
      paid_cents: amountPaid,
      paid_at: new Date().toISOString(),
    })
    .eq('id', row.id)

  // Record a payment row
  await supabaseAdmin.from('ehr_payments').insert({
    practice_id: row.practice_id,
    patient_id: row.patient_id,
    source: 'patient_stripe',
    amount_cents: amountPaid,
    stripe_payment_intent_id: (inv.payment_intent as string) || null,
    note: `Stripe invoice ${inv.id}`,
  })

  // Update each charge's status to paid — naive: mark all linked charges paid.
  if (row.charge_ids && row.charge_ids.length > 0) {
    await supabaseAdmin
      .from('ehr_charges')
      .update({ status: 'paid' })
      .in('id', row.charge_ids)
      .eq('practice_id', row.practice_id)
  }
}

async function handlePaymentFailed(inv: Stripe.Invoice) {
  const { data: row } = await supabaseAdmin
    .from('ehr_invoices').select('id, practice_id')
    .eq('stripe_invoice_id', inv.id).maybeSingle()
  if (!row) return
  await supabaseAdmin.from('audit_logs').insert({
    practice_id: row.practice_id,
    user_id: '00000000-0000-0000-0000-000000000000',
    user_email: 'stripe-webhook',
    action: 'note.update',
    resource_type: 'ehr_progress_note', // closest existing enum — will broaden later
    resource_id: row.id,
    details: { kind: 'invoice_payment_failed', stripe_invoice_id: inv.id },
    severity: 'warn',
  })
}

async function handleInvoiceVoided(inv: Stripe.Invoice) {
  await supabaseAdmin
    .from('ehr_invoices')
    .update({ status: 'void' })
    .eq('stripe_invoice_id', inv.id)
}
