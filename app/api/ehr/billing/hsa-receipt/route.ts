// app/api/ehr/billing/hsa-receipt/route.ts
//
// Wave 43 / T5 — therapist-side HSA/FSA receipt generation.
//
// Returns a single-page PDF receipt for all patient-paid amounts in
// [from, to]. Skips ERA / insurance-paid rows — HSA/FSA plans only
// reimburse out-of-pocket spend.
//
// Generated live each call. No snapshot bucket: the source-of-truth
// data lives in ehr_payments, and the patient can request a fresh copy
// any time. If we ever need immutable snapshots for HSA the same
// pattern as billing/superbill/pdf can be ported in.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import {
  renderHsaReceiptPdf,
  buildReceiptNumber,
  type HsaReceiptPaymentLine,
} from '@/lib/ehr/hsa-receipt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PATIENT_PAID_SOURCES = new Set([
  'patient_stripe',
  'manual_check',
  'manual_cash',
  'manual_card_external',
])

function methodLabel(source: string): string {
  switch (source) {
    case 'patient_stripe':       return 'Card (Stripe)'
    case 'manual_check':         return 'Check'
    case 'manual_cash':          return 'Cash'
    case 'manual_card_external': return 'Card (external)'
    default:                     return source
  }
}

function referenceFor(p: any): string {
  if (p.stripe_payment_intent_id) return p.stripe_payment_intent_id.slice(-12)
  if (p.note) return String(p.note).slice(0, 28)
  return ''
}

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const sp = req.nextUrl.searchParams
  const patientId = sp.get('patient_id')
  const from = sp.get('from')
  const to = sp.get('to')
  if (!patientId || !from || !to) {
    return NextResponse.json({ error: 'patient_id, from, to required' }, { status: 400 })
  }

  const [practiceRes, patientRes, paymentsRes] = await Promise.all([
    pool.query(
      `SELECT name, address_line1, address_line2, city, state, zip,
              phone, notification_email AS email, npi, tax_id
         FROM practices WHERE id = $1 LIMIT 1`,
      [ctx.practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT first_name, last_name, dob
         FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
      [patientId, ctx.practiceId],
    ),
    pool.query(
      `SELECT id, source, amount_cents, received_at,
              stripe_payment_intent_id, note, charge_id
         FROM ehr_payments
        WHERE practice_id = $1 AND patient_id = $2
          AND received_at::date >= $3::date
          AND received_at::date <= $4::date
          AND amount_cents > 0
        ORDER BY received_at ASC`,
      [ctx.practiceId, patientId, from, to],
    ).catch(() => ({ rows: [] as any[] })),
  ])

  const patient = patientRes.rows[0]
  if (!patient) return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
  const practice = practiceRes.rows[0] ?? { name: 'Practice' }

  const payments: HsaReceiptPaymentLine[] = paymentsRes.rows
    .filter((r: any) => PATIENT_PAID_SOURCES.has(r.source))
    .map((r: any) => ({
      paid_at: r.received_at,
      method: methodLabel(r.source),
      amount_cents: Number(r.amount_cents),
      reference: referenceFor(r),
    }))

  if (payments.length === 0) {
    return NextResponse.json(
      { error: 'no patient-paid payments in range' },
      { status: 404 },
    )
  }

  const generatedAt = new Date()
  const receiptNumber = buildReceiptNumber(ctx.practiceId, generatedAt)

  const bytes = await renderHsaReceiptPdf({
    practice,
    patient,
    range_start: from,
    range_end: to,
    generated_at: generatedAt.toISOString(),
    receipt_number: receiptNumber,
    payments,
  })

  await auditEhrAccess({
    ctx,
    action: 'hsa_receipt.generated',
    resourceType: 'hsa_receipt',
    resourceId: receiptNumber,
    details: {
      payment_count: payments.length,
      total_cents: payments.reduce((n, p) => n + p.amount_cents, 0),
    },
  })

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="hsa-receipt-${receiptNumber}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
