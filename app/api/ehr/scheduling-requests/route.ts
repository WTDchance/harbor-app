// app/api/ehr/scheduling-requests/route.ts — therapist list + approve/decline.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function GET(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  let q = supabaseAdmin
    .from('ehr_scheduling_requests')
    .select('id, patient_id, preferred_windows, patient_note, therapist_note, duration_minutes, appointment_type, status, appointment_id, created_at, responded_at')
    .eq('practice_id', auth.practiceId)
    .order('created_at', { ascending: false })
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requests: data ?? [] })
}
