// app/api/portal/homework/route.ts — patient's homework list.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPortalSession } from '@/lib/ehr/portal'

export async function GET() {
  const s = await getPortalSession(); if (!s) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const { data, error } = await supabaseAdmin
    .from('ehr_homework')
    .select('id, title, description, due_date, status, completed_at, created_at')
    .eq('practice_id', s.practice_id).eq('patient_id', s.patient_id)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ homework: data ?? [] })
}
