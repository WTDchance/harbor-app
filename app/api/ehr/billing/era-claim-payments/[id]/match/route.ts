// app/api/ehr/billing/era-claim-payments/[id]/match/route.ts
//
// Wave 41 / T4 — manual match an unmatched ERA claim-payment row to
// an invoice. Applies paid_cents to the invoice and audits.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: paymentId } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const invoiceId = typeof body?.invoice_id === 'string' ? body.invoice_id : ''
  if (!invoiceId) {
    return NextResponse.json({ error: { code: 'invalid_request', message: 'invoice_id required' } }, { status: 400 })
  }

  // Verify the payment row + invoice both belong to this practice.
  const cur = await pool.query(
    `SELECT id, practice_id, paid_amount_cents, match_kind
       FROM ehr_era_claim_payments
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [paymentId, ctx.practiceId],
  )
  if (cur.rows.length === 0) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
  if (cur.rows[0].match_kind !== 'unmatched') {
    return NextResponse.json(
      { error: { code: 'already_matched', message: 'Payment is already matched.' } },
      { status: 409 },
    )
  }
  const inv = await pool.query(
    `SELECT id FROM ehr_invoices WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [invoiceId, ctx.practiceId],
  )
  if (inv.rows.length === 0) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  // Wrap in a transaction so the invoice update + payment match are atomic.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const upd = await client.query(
      `UPDATE ehr_era_claim_payments
          SET matched_invoice_id = $1,
              match_kind         = 'manual',
              matched_by_user_id = $2,
              matched_at         = NOW()
        WHERE id = $3 AND practice_id = $4
        RETURNING *`,
      [invoiceId, ctx.user.id, paymentId, ctx.practiceId],
    )

    await client.query(
      `UPDATE ehr_invoices
          SET paid_cents = paid_cents + $1,
              status     = CASE
                             WHEN paid_cents + $1 >= total_cents THEN 'paid'
                             WHEN paid_cents + $1 > 0           THEN 'partial'
                             ELSE status
                           END,
              paid_at    = CASE
                             WHEN paid_cents + $1 >= total_cents AND paid_at IS NULL THEN NOW()
                             ELSE paid_at
                           END,
              updated_at = NOW()
        WHERE id = $2 AND practice_id = $3`,
      [upd.rows[0].paid_amount_cents, invoiceId, ctx.practiceId],
    )

    await client.query('COMMIT')

    await auditEhrAccess({
      ctx,
      action: 'era.matched_manual',
      resourceType: 'ehr_era_claim_payment',
      resourceId: paymentId,
      details: {
        invoice_id: invoiceId,
        paid_amount_cents: upd.rows[0].paid_amount_cents,
      },
    })

    return NextResponse.json({ payment: upd.rows[0] })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
