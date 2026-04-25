// Harbor EHR — list + create patient-billable Stripe invoices.
//
// POST flow:
//   1. Body: { patient_id, charge_ids: [] }
//   2. Ensure the patient has a Stripe customer (create + persist if missing)
//   3. Create one Stripe invoice item per charge, finalize, send
//   4. Persist an ehr_invoices row; the Stripe webhook reconciles payment

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { stripe, isStripeConfigured } from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const sp = req.nextUrl.searchParams
  const patientId = sp.get('patient_id')
  const conds: string[] = ['practice_id = $1']
  const args: unknown[] = [ctx.practiceId]
  if (patientId) { args.push(patientId); conds.push(`patient_id = $${args.length}`) }

  const { rows } = await pool.query(
    `SELECT id, patient_id, charge_ids, total_cents, paid_cents, status,
            stripe_payment_url, sent_at, paid_at, due_date, created_at
       FROM ehr_invoices
      WHERE ${conds.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT 100`,
    args,
  )

  await auditEhrAccess({
    ctx,
    action: 'billing.invoice.list',
    resourceType: 'ehr_invoice',
    details: { count: rows.length, patient_id: patientId },
  })
  return NextResponse.json({ invoices: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  if (!isStripeConfigured() || !stripe) {
    return NextResponse.json({ error: 'Stripe is not configured on this server' }, { status: 500 })
  }
  const sk = stripe // narrowed non-null

  const body = await req.json().catch(() => null)
  const patientId = body?.patient_id
  const chargeIds: string[] = Array.isArray(body?.charge_ids) ? body.charge_ids : []
  if (!patientId || chargeIds.length === 0) {
    return NextResponse.json({ error: 'patient_id and charge_ids required' }, { status: 400 })
  }

  // Patient + practice
  const patientResult = await pool.query(
    `SELECT id, first_name, last_name, email, stripe_customer_id
       FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [patientId, ctx.practiceId],
  )
  const patient = patientResult.rows[0]
  if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
  if (!patient.email) {
    return NextResponse.json(
      { error: 'Patient needs an email before we can invoice them' },
      { status: 400 },
    )
  }

  // Charges to bill
  const chargesResult = await pool.query(
    `SELECT id, cpt_code, units, fee_cents, allowed_cents, copay_cents,
            billed_to, status, service_date
       FROM ehr_charges
      WHERE practice_id = $1 AND patient_id = $2 AND id = ANY($3::uuid[])`,
    [ctx.practiceId, patientId, chargeIds],
  )
  const charges = chargesResult.rows
  if (charges.length === 0) {
    return NextResponse.json({ error: 'No matching charges found' }, { status: 404 })
  }
  for (const c of charges) {
    if (!['both', 'patient_self_pay'].includes(c.billed_to)) {
      return NextResponse.json(
        { error: `Charge ${c.id} is not patient-billable (billed_to=${c.billed_to})` },
        { status: 400 },
      )
    }
  }

  // copay for 'both', full allowed for 'patient_self_pay'
  const lineAmount = (c: any): number =>
    c.billed_to === 'both' ? Number(c.copay_cents) : Number(c.allowed_cents)

  // Ensure Stripe customer
  let customerId: string | null = patient.stripe_customer_id ?? null
  if (!customerId) {
    const cust = await sk.customers.create({
      email: patient.email,
      name: `${patient.first_name} ${patient.last_name}`.trim(),
      metadata: {
        harbor_practice_id: ctx.practiceId!,
        harbor_patient_id: patient.id,
      },
    })
    customerId = cust.id
    await pool.query(
      `UPDATE patients SET stripe_customer_id = $1 WHERE id = $2`,
      [customerId, patient.id],
    )
  }

  // Invoice items, then finalize + send
  for (const c of charges) {
    await sk.invoiceItems.create({
      customer: customerId,
      amount: lineAmount(c),
      currency: 'usd',
      description: `${c.cpt_code} · ${new Date(c.service_date).toLocaleDateString()}`,
      metadata: {
        harbor_charge_id: c.id,
        harbor_practice_id: ctx.practiceId!,
      },
    })
  }

  const practiceResult = await pool.query(
    `SELECT name FROM practices WHERE id = $1 LIMIT 1`,
    [ctx.practiceId],
  )
  const practiceName = practiceResult.rows[0]?.name ?? 'your therapist'

  const invoice = await sk.invoices.create({
    customer: customerId,
    auto_advance: false,
    collection_method: 'send_invoice',
    days_until_due: 14,
    description: `Services from ${practiceName}`,
    metadata: {
      harbor_practice_id: ctx.practiceId!,
      harbor_patient_id: patient.id,
      harbor_charge_ids: chargeIds.join(','),
    },
  })
  await sk.invoices.finalizeInvoice(invoice.id!)
  const sent = await sk.invoices.sendInvoice(invoice.id!)
  const total = Number(sent.amount_due)
  const payUrl = sent.hosted_invoice_url || null

  const insert = await pool.query(
    `INSERT INTO ehr_invoices (
       practice_id, patient_id, charge_ids,
       subtotal_cents, total_cents, paid_cents, status,
       stripe_invoice_id, stripe_payment_url, sent_at, due_date, created_by
     ) VALUES (
       $1, $2, $3::uuid[], $4, $5, 0, 'sent', $6, $7, NOW(), $8, $9
     ) RETURNING *`,
    [
      ctx.practiceId, patient.id, chargeIds,
      total, total,
      sent.id, payUrl,
      sent.due_date ? new Date(sent.due_date * 1000).toISOString().slice(0, 10) : null,
      ctx.user.id,
    ],
  )
  const row = insert.rows[0]

  await auditEhrAccess({
    ctx,
    action: 'billing.invoice.create',
    resourceType: 'ehr_invoice',
    resourceId: row.id,
    details: {
      stripe_invoice_id: sent.id,
      total_cents: total,
      charge_ids: chargeIds,
    },
  })

  return NextResponse.json({ invoice: row, pay_url: payUrl }, { status: 201 })
}
