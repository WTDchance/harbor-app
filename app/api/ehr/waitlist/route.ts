// app/api/ehr/waitlist/route.ts — list and update waitlist entries.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'

export async function GET() {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { data, error } = await supabaseAdmin
    .from('waitlist')
    .select('id, patient_name, patient_phone, patient_email, insurance_type, session_type, reason, priority, status, notes, flexible_day_time, opt_in_last_minute, opt_in_flash_fill, composite_score, created_at')
    .eq('practice_id', auth.practiceId)
    .order('composite_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ entries: data ?? [] })
}
