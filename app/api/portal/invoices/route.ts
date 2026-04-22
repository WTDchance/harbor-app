// app/api/portal/invoices/route.ts — patient sees their invoices.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPortalSession } from '@/lib/ehr/portal'

export async function GET() {
  const s = await getPortalSession(); if (!s) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const { data, error } = await supabaseAdmin
    .from('ehr_invoices')
    .select('id, total_cents, paid_cents, status, stripe_payment_url, sent_at, paid_at, due_date, created_at')
    .eq('practice_id', s.practice_id).eq('patient_id', s.patient_id)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invoices: data ?? [] })
}
