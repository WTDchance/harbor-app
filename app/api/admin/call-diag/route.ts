// Temporary diagnostic endpoint for tracing call pipeline issues
// Auth: Bearer ${CRON_SECRET}
// GET /api/admin/call-diag?practice_id=<uuid>

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const practiceId = req.nextUrl.searchParams.get('practice_id')
  if (!practiceId) {
    return NextResponse.json({ error: 'practice_id required' }, { status: 400 })
  }

  // Recent call logs
  const { data: calls, error: callErr } = await supabaseAdmin
    .from('call_logs')
    .select('id, vapi_call_id, patient_phone, call_summary, created_at, practice_id')
    .eq('practice_id', practiceId)
    .order('created_at', { ascending: false })
    .limit(10)

  // Recent intake forms
  const { data: intakes, error: intakeErr } = await supabaseAdmin
    .from('intake_forms')
    .select('id, practice_id, patient_id, call_log_id, delivery_method, sms_sent, email_sent, status, created_at, patient_phone, patient_email')
    .eq('practice_id', practiceId)
    .order('created_at', { ascending: false })
    .limit(10)

  // Recent patients
  const { data: patients, error: patErr } = await supabaseAdmin
    .from('patients')
    .select('id, first_name, last_name, phone, email, created_at')
    .eq('practice_id', practiceId)
    .order('created_at', { ascending: false })
    .limit(10)

  return NextResponse.json({
    call_logs: { data: calls, error: callErr?.message },
    intake_forms: { data: intakes, error: intakeErr?.message },
    patients: { data: patients, error: patErr?.message },
  })
}
