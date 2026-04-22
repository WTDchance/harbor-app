// app/api/portal/superbills/route.ts — patient sees superbills issued to them.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPortalSession } from '@/lib/ehr/portal'

export async function GET() {
  const s = await getPortalSession(); if (!s) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const { data, error } = await supabaseAdmin
    .from('ehr_superbills')
    .select('id, from_date, to_date, total_cents, generated_at')
    .eq('practice_id', s.practice_id).eq('patient_id', s.patient_id)
    .order('generated_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ superbills: data ?? [] })
}
