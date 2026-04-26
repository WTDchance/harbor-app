// Therapist-initiated payment recording.
//
// Single-row insert into ehr_payments. If the payment is applied to a
// specific charge, we recompute that charge's status (paid / partial)
// based on the sum of all payments against it.
//
// NOT for Stripe webhook ingestion — that flow stays in Bucket 2 (signed
// webhook signature verification, idempotency keying, etc.).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null) as any
  if (!body?.amount_cents || !body?.source) {
    return NextResponse.json({ error: 'amount_cents and source required' }, { status: 400 })
  }

  const { rows } = await pool.query(
    `INSERT INTO ehr_payments (
       practice_id, patient_id, charge_id, source,
       amount_cents, note, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      ctx.practiceId,
      body.patient_id ?? null,
      body.charge_id ?? null,
      body.source,
      body.amount_cents,
      body.note ?? null,
      ctx.user.id,
    ],
  )
  const payment = rows[0]

  // If this payment is applied to a specific charge, recompute that
  // charge's status (paid / partial). Errors here don't fail the insert.
  if (body.charge_id) {
    try {
      const { rows: chargeRows } = await pool.query(
        `SELECT allowed_cents FROM ehr_charges WHERE id = $1 LIMIT 1`,
        [body.charge_id],
      )
      const charge = chargeRows[0]
      const { rows: sumRows } = await pool.query(
        `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total
           FROM ehr_payments WHERE charge_id = $1`,
        [body.charge_id],
      )
      const totalPaid = Number(sumRows[0]?.total ?? 0)
      if (charge) {
        const newStatus = totalPaid >= Number(charge.allowed_cents) ? 'paid' : 'partial'
        await pool.query(
          `UPDATE ehr_charges SET status = $1, updated_at = NOW() WHERE id = $2`,
          [newStatus, body.charge_id],
        )
      }
    } catch (err) {
      console.error('[billing/payments] charge status recompute failed:', (err as Error).message)
    }
  }

  await auditEhrAccess({
    ctx,
    action: 'billing.payment.create',
    resourceType: 'ehr_payment',
    resourceId: payment.id,
    details: {
      source: body.source,
      amount_cents: body.amount_cents,
      patient_id: body.patient_id ?? null,
      charge_id: body.charge_id ?? null,
    },
  })

  return NextResponse.json({ payment }, { status: 201 })
}
