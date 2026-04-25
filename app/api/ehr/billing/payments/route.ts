// app/api/ehr/billing/payments/route.ts — record a manual payment.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function POST(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const body = await req.json().catch(() => null)
  if (!body?.amount_cents || !body?.source) {
    return NextResponse.json({ error: 'amount_cents and source required' }, { status: 400 })
  }
  const { data, error } = await supabaseAdmin
    .from('ehr_payments')
    .insert({
      practice_id: auth.practiceId,
      patient_id: body.patient_id ?? null,
      charge_id: body.charge_id ?? null,
      source: body.source,
      amount_cents: body.amount_cents,
      note: body.note ?? null,
      created_by: auth.user.id,
    })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // If applied to a specific charge, update charge status when fully paid
  if (body.charge_id) {
    const { data: charge } = await supabaseAdmin
      .from('ehr_charges').select('allowed_cents').eq('id', body.charge_id).maybeSingle()
    const { data: allPayments } = await supabaseAdmin
      .from('ehr_payments').select('amount_cents').eq('charge_id', body.charge_id)
    const totalPaid = (allPayments ?? []).reduce((s: number, p: any) => s + Number(p.amount_cents), 0)
    const newStatus = charge && totalPaid >= Number(charge.allowed_cents) ? 'paid' : 'partial'
    await supabaseAdmin.from('ehr_charges').update({ status: newStatus }).eq('id', body.charge_id)
  }

  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.create',
    resourceId: data.id, details: { kind: 'payment', source: body.source, amount_cents: body.amount_cents },
  })
  return NextResponse.json({ payment: data }, { status: 201 })
}
