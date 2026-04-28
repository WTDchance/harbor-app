// app/api/portal/hsa-receipts/route.ts
//
// Wave 43 / T5 — patient-side HSA/FSA receipt generation.
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD streams the receipt PDF for the
// signed-in portal patient. Mirrors the therapist endpoint but is
// scoped to sess.patientId (not a query parameter) so a portal session
// can't request another patient's payments.

import { NextResponse, type NextRequest } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'
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

export async function GET(req: NextRequest) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const sp = req.nextUrl.searchParams
  const from = sp.get('from')
  const to = sp.get('to')
  if (!from || !to) {
    return NextResponse.json({ error: 'from, to required' }, { status: 400 })
  }

  const [practiceRes, patientRes, paymentsRes] = await Promise.all([
    pool.query(
      `SELECT name, address_line1, address_line2, city, state, zip,
              phone, notification_email AS email, npi, tax_id
         FROM practices WHERE id = $1 LIMIT 1`,
      [sess.practiceId],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT first_name, last_name, dob
         FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
      [sess.patientId, sess.practiceId],
    ),
    pool.query(
      `SELECT id, source, amount_cents, received_at,
              stripe_payment_intent_id, note
         FROM ehr_payments
        WHERE practice_id = $1 AND patient_id = $2
          AND received_at::date >= $3::date
          AND received_at::date <= $4::date
          AND amount_cents > 0
        ORDER BY received_at ASC`,
      [sess.practiceId, sess.patientId, from, to],
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
      reference: r.stripe_payment_intent_id
        ? r.stripe_payment_intent_id.slice(-12)
        : (r.note ? String(r.note).slice(0, 28) : ''),
    }))

  if (payments.length === 0) {
    return NextResponse.json(
      { error: 'no patient-paid payments in range' },
      { status: 404 },
    )
  }

  const generatedAt = new Date()
  const receiptNumber = buildReceiptNumber(sess.practiceId, generatedAt)

  const bytes = await renderHsaReceiptPdf({
    practice,
    patient,
    range_start: from,
    range_end: to,
    generated_at: generatedAt.toISOString(),
    receipt_number: receiptNumber,
    payments,
  })

  await auditPortalAccess({
    session: sess,
    action: 'portal.hsa_receipt.download',
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
