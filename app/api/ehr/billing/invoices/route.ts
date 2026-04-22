// app/api/ehr/billing/invoices/route.ts
// Create a Stripe invoice for a patient covering one or more charges.
// Flow:
//   1. POST with { patient_id, charge_ids }
//   2. Ensure patient has a Stripe customer (create if missing, store on patient row)
//   3. Create a Stripe invoice with one invoice_item per charge
//   4. Send (or finalize) → returns hosted invoice URL
//   5. Persist ehr_invoices row; webhook reconciles payment

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'
import { stripe, isStripeConfigured } from '@/lib/stripe'

export async function GET(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')
  let q = supabaseAdmin
    .from('ehr_invoices')
    .select('id, patient_id, charge_ids, total_cents, paid_cents, status, stripe_payment_url, sent_at, paid_at, due_date, created_at')
    .eq('practice_id', auth.practiceId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (patientId) q = q.eq('patient_id', patientId)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invoices: data ?? [] })
}

export async function POST(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  if (!isStripeConfigured() || !stripe) {
    return NextResponse.json({ error: 'Stripe is not configured on this server' }, { status: 500 })
  }
  const sk = stripe! // narrow to non-null for the rest of the handler
  const body = await req.json().catch(() => null)
  const patientId = body?.patient_id
  const chargeIds: string[] = Array.isArray(body?.charge_ids) ? body.charge_ids : []
  if (!patientId || chargeIds.length === 0) {
    return NextResponse.json({ error: 'patient_id and charge_ids required' }, { status: 400 })
  }

  // Load patient + practice
  const [{ data: patient }, { data: practice }] = await Promise.all([
    supabaseAdmin.from('patients').select('id, first_name, last_name, email, stripe_customer_id').eq('id', patientId).eq('practice_id', auth.practiceId).maybeSingle(),
    supabaseAdmin.from('practices').select('name').eq('id', auth.practiceId).maybeSingle(),
  ])
  if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
  if (!patient.email) return NextResponse.json({ error: 'Patient needs an email before we can invoice them' }, { status: 400 })

  // Charges for the invoice
  const { data: charges } = await supabaseAdmin
    .from('ehr_charges').select('id, cpt_code, units, fee_cents, allowed_cents, copay_cents, billed_to, status, service_date')
    .eq('practice_id', auth.practiceId).eq('patient_id', patientId).in('id', chargeIds)
  if (!charges || charges.length === 0) {
    return NextResponse.json({ error: 'No matching charges found' }, { status: 404 })
  }
  for (const c of charges) {
    if (!['both', 'patient_self_pay'].includes(c.billed_to)) {
      return NextResponse.json({ error: `Charge ${c.id} is not patient-billable (billed_to=${c.billed_to})` }, { status: 400 })
    }
  }

  // Amount each charge contributes to this invoice — copay for 'both', full allowed for 'patient_self_pay'
  function lineAmount(c: any): number {
    return c.billed_to === 'both' ? Number(c.copay_cents) : Number(c.allowed_cents)
  }

  // Ensure Stripe customer
  let customerId: string | null = (patient as any).stripe_customer_id || null
  if (!customerId) {
    const cust = await sk.customers.create({
      email: patient.email,
      name: `${patient.first_name} ${patient.last_name}`.trim(),
      metadata: {
        harbor_practice_id: auth.practiceId,
        harbor_patient_id: patient.id,
      },
    })
    customerId = cust.id
    await supabaseAdmin.from('patients').update({ stripe_customer_id: customerId }).eq('id', patient.id)
  }

  // Create invoice items first, then finalize invoice
  for (const c of charges) {
    await sk.invoiceItems.create({
      customer: customerId,
      amount: lineAmount(c),
      currency: 'usd',
      description: `${c.cpt_code} · ${new Date(c.service_date).toLocaleDateString()}`,
      metadata: {
        harbor_charge_id: c.id,
        harbor_practice_id: auth.practiceId,
      },
    })
  }

  const invoice = await sk.invoices.create({
    customer: customerId,
    auto_advance: false, // we'll finalize explicitly
    collection_method: 'send_invoice',
    days_until_due: 14,
    description: `Services from ${practice?.name ?? 'your therapist'}`,
    metadata: {
      harbor_practice_id: auth.practiceId,
      harbor_patient_id: patient.id,
      harbor_charge_ids: chargeIds.join(','),
    },
  })

  await sk.invoices.finalizeInvoice(invoice.id)
  const sent = await sk.invoices.sendInvoice(invoice.id)

  const total = Number(sent.amount_due)
  const payUrl = sent.hosted_invoice_url || null

  const { data: row, error } = await supabaseAdmin
    .from('ehr_invoices')
    .insert({
      practice_id: auth.practiceId,
      patient_id: patient.id,
      charge_ids: chargeIds,
      subtotal_cents: total,
      total_cents: total,
      paid_cents: 0,
      status: 'sent',
      stripe_invoice_id: sent.id,
      stripe_payment_url: payUrl,
      sent_at: new Date().toISOString(),
      due_date: sent.due_date ? new Date(sent.due_date * 1000).toISOString().slice(0, 10) : null,
      created_by: auth.user.id,
    })
    .select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.create',
    resourceId: row.id, details: { kind: 'stripe_invoice_sent', stripe_invoice_id: sent.id, total_cents: total, charge_ids: chargeIds },
    severity: 'warn',
  })

  return NextResponse.json({ invoice: row, pay_url: payUrl }, { status: 201 })
}
