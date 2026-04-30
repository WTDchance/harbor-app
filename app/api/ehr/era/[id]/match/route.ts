// W52 D4 — manually match a payment line to an invoice/appointment.
import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: eraId } = await params

  const body = await req.json().catch(() => null) as
    { payment_id: string; invoice_id?: string; appointment_id?: string; patient_id?: string } | null
  if (!body?.payment_id) return NextResponse.json({ error: 'payment_id_required' }, { status: 400 })

  const upd = await pool.query(
    `UPDATE era_claim_payments
        SET invoice_id = COALESCE($1, invoice_id),
            appointment_id = COALESCE($2, appointment_id),
            patient_id = COALESCE($3, patient_id),
            match_method = 'manual',
            matched_at = NOW(),
            matched_by_user_id = $4
      WHERE id = $5 AND era_id = $6 AND practice_id = $7
      RETURNING id`,
    [body.invoice_id ?? null, body.appointment_id ?? null, body.patient_id ?? null, ctx.user.id, body.payment_id, eraId, ctx.practiceId],
  )
  if (upd.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Recompute remittance status.
  const counts = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE matched_at IS NOT NULL)::int AS matched
       FROM era_claim_payments WHERE era_id = $1`,
    [eraId],
  )
  const t = counts.rows[0].total, m = counts.rows[0].matched
  const status = t === 0 ? 'unmatched' : m === t ? 'fully_matched' : m > 0 ? 'partially_matched' : 'unmatched'
  await pool.query(`UPDATE era_remittances SET status = $1 WHERE id = $2 AND practice_id = $3`, [status, eraId, ctx.practiceId])

  await writeAuditLog({
    practice_id: ctx.practiceId, user_id: ctx.user.id,
    action: 'era.manually_matched',
    resource_type: 'era_claim_payment', resource_id: body.payment_id,
    severity: 'info',
    details: { era_id: eraId, status_after: status },
  })

  return NextResponse.json({ ok: true, status })
}
