// Harbor EHR — list + manually create charges.
// Auto-charge creation from signed notes lives in lib/ehr/billing.ts (still
// Supabase-coupled — phase-4b will port createChargesForSignedNote).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { feeForCpt } from '@/lib/aws/billing/calc' // pure helper — no Supabase deps
import { applySlidingFee } from '@/lib/aws/billing/sliding-fee'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const sp = req.nextUrl.searchParams
  const status = sp.get('status')
  const patientId = sp.get('patient_id')
  const limit = Math.min(Number(sp.get('limit') ?? 200), 500)

  const conds: string[] = ['practice_id = $1']
  const args: unknown[] = [ctx.practiceId]
  if (status)    { args.push(status);    conds.push(`status = $${args.length}`) }
  if (patientId) { args.push(patientId); conds.push(`patient_id = $${args.length}`) }
  args.push(limit)

  const { rows } = await pool.query(
    `SELECT id, patient_id, note_id, appointment_id, cpt_code, units,
            fee_cents, allowed_cents, copay_cents, billed_to, status,
            service_date, place_of_service, created_at
       FROM ehr_charges
      WHERE ${conds.join(' AND ')}
      ORDER BY service_date DESC
      LIMIT $${args.length}`,
    args,
  )

  await auditEhrAccess({
    ctx,
    action: 'billing.charge.list',
    resourceType: 'ehr_charge',
    details: { count: rows.length, status, patient_id: patientId },
  })
  return NextResponse.json({ charges: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body?.patient_id || !body?.cpt_code) {
    return NextResponse.json({ error: 'patient_id and cpt_code required' }, { status: 400 })
  }

  // Per-practice CPT fee override lives in practices.default_fee_schedule_cents (jsonb).
  const practiceFee = await pool.query(
    `SELECT default_fee_schedule_cents FROM practices WHERE id = $1 LIMIT 1`,
    [ctx.practiceId],
  ).catch(() => ({ rows: [] as any[] }))
  const schedule = practiceFee.rows[0]?.default_fee_schedule_cents ?? null
  const baseFee = body.fee_cents ?? feeForCpt(body.cpt_code, schedule)

  // Wave 41 / T6 — sliding-fee discount, if practice has it enabled
  // and the patient is assigned a matching tier. No-op when off.
  // Caller can opt out with body.skip_sliding_fee=true (e.g. when a
  // therapist explicitly enters a fee_cents override and means it).
  let fee = baseFee
  let appliedTier: string | null = null
  let appliedPct: number | null = null
  if (!body.skip_sliding_fee) {
    const sliding = await applySlidingFee({
      practiceId: ctx.practiceId!,
      patientId: body.patient_id,
      baseCents: baseFee,
    })
    fee = sliding.adjustedCents
    appliedTier = sliding.tierApplied
    appliedPct = sliding.feePct
  }

  const { rows } = await pool.query(
    `INSERT INTO ehr_charges (
       practice_id, patient_id, note_id, appointment_id,
       cpt_code, units, fee_cents, allowed_cents, copay_cents, billed_to,
       status, service_date, place_of_service, created_by
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11, $12, $13
     ) RETURNING *`,
    [
      ctx.practiceId, body.patient_id, body.note_id ?? null, body.appointment_id ?? null,
      body.cpt_code, body.units ?? 1, fee, body.allowed_cents ?? fee, body.copay_cents ?? 0,
      body.billed_to ?? 'insurance',
      body.service_date ?? new Date().toISOString().slice(0, 10),
      body.place_of_service ?? null,
      ctx.user.id,
    ],
  )
  const charge = rows[0]

  await auditEhrAccess({
    ctx,
    action: 'billing.charge.create',
    resourceType: 'ehr_charge',
    resourceId: charge.id,
    details: {
      kind: 'charge_manual',
      cpt: charge.cpt_code,
      fee_cents: charge.fee_cents,
      // Wave 41 / T6 — surface sliding-fee outcome on every charge audit.
      base_fee_cents: baseFee,
      sliding_fee_tier_applied: appliedTier,
      sliding_fee_pct: appliedPct,
    },
  })
  return NextResponse.json({ charge }, { status: 201 })
}
