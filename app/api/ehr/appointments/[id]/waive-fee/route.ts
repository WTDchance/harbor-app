// app/api/ehr/appointments/[id]/waive-fee/route.ts
//
// Wave 42 — Therapist-side waiver for late-cancel and no-show fees.
//
// POST body: { kind: 'late_cancel' | 'no_show', reason?: string }
//
// Refunds the Stripe charge (if one was captured), zeroes out the
// per-appointment *_charged_cents column, clears the *_stripe_charge_id
// reference, and writes an audit_logs row with the typed
// cancellation_fee.waived / no_show_fee.waived action so the therapist
// user is non-repudiable. Refund failures don't block the waiver — the
// audit row records refunded=false so finance can chase the gap up.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { waiveCancellationFee } from '@/lib/aws/ehr/cancellation-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const body = await req.json().catch(() => null)
  const kind = body?.kind
  const reason = typeof body?.reason === 'string' ? body.reason : undefined
  if (kind !== 'late_cancel' && kind !== 'no_show') {
    return NextResponse.json({ error: 'kind must be "late_cancel" or "no_show"' }, { status: 400 })
  }

  // Belt-and-braces tenant guard: never waive a fee on an appointment
  // outside the caller's practice.
  const owns = await pool.query(
    `SELECT 1 FROM appointments WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, ctx.practiceId],
  )
  if (owns.rowCount === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  try {
    const result = await waiveCancellationFee({ ctx, appointmentId: id, kind, reason })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = (err as Error).message
    if (msg === 'appointment_not_found') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    console.error('[waive-fee]', msg)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}


export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const { rows } = await pool.query(
    `SELECT id,
            late_canceled_at,
            cancellation_fee_charged_cents,
            cancellation_fee_stripe_charge_id,
            no_show_fee_charged_cents,
            no_show_fee_stripe_charge_id,
            status
       FROM appointments
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, ctx.practiceId],
  )
  if (rows.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const r = rows[0]
  return NextResponse.json({
    appointment_id: id,
    late_canceled_at: r.late_canceled_at,
    cancellation_fee_charged_cents: r.cancellation_fee_charged_cents,
    cancellation_fee_stripe_charge_id: r.cancellation_fee_stripe_charge_id,
    no_show_fee_charged_cents: r.no_show_fee_charged_cents,
    no_show_fee_stripe_charge_id: r.no_show_fee_stripe_charge_id,
    status: r.status,
  })
}
