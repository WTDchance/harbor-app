// app/api/ehr/billing/patient-summary/route.ts
//
// Wave 22 (AWS port). Patient AR summary card on the billing page.
// Was on Supabase via lib/ehr/billing.patientBillingSummary; now
// inlined as raw SQL on the pool with the same response shape.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')
  if (!patientId) return NextResponse.json({ error: 'patient_id required' }, { status: 400 })

  try {
    const [chargesRes, paymentsRes] = await Promise.all([
      pool.query(
        `SELECT id, cpt_code, units, fee_cents, allowed_cents, copay_cents,
                billed_to, status, service_date, created_at
           FROM ehr_charges
          WHERE practice_id = $1 AND patient_id = $2
          ORDER BY service_date DESC NULLS LAST
          LIMIT 25`,
        [ctx.practiceId, patientId],
      ),
      pool.query(
        `SELECT id, source, amount_cents, received_at, charge_id, note
           FROM ehr_payments
          WHERE practice_id = $1 AND patient_id = $2
          ORDER BY received_at DESC NULLS LAST
          LIMIT 25`,
        [ctx.practiceId, patientId],
      ),
    ])

    let billed = 0
    let paid = 0
    let writtenOff = 0
    for (const c of chargesRes.rows) {
      if (c.status === 'void') continue
      billed += Number(c.allowed_cents) || 0
      if (c.status === 'paid') paid += Number(c.allowed_cents) || 0
      if (c.status === 'written_off') writtenOff += Number(c.allowed_cents) || 0
    }
    const pyTotal = paymentsRes.rows.reduce(
      (s: number, p: any) => s + (Number(p.amount_cents) || 0),
      0,
    )
    const balance = Math.max(0, billed - pyTotal - writtenOff)

    return NextResponse.json({
      balance_cents: balance,
      billed_cents: billed,
      received_cents: pyTotal,
      written_off_cents: writtenOff,
      charges: chargesRes.rows,
      payments: paymentsRes.rows,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    )
  }
}
