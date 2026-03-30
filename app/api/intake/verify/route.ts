import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// GET /api/intake/verify?token=abc123
// Public endpoint — validates token and returns practice info for the form
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  const { data: tokenData, error } = await supabaseAdmin
    .from('intake_tokens')
    .select(`
      id,
      practice_id,
      patient_name,
      patient_phone,
      patient_email,
      status,
      expires_at,
      practices:practice_id (
        name,
        provider_name,
        ai_name
      )
    `)
    .eq('token', token)
    .single()

  if (error || !tokenData) {
    return NextResponse.json({ error: 'Invalid or expired intake link.' }, { status: 404 })
  }

  // Check expiry
  if (tokenData.expires_at && new Date(tokenData.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This intake link has expired. Please contact the practice for a new one.' }, { status: 410 })
  }

  // Check if already completed
  if (tokenData.status === 'completed') {
    return NextResponse.json({ error: 'This intake form has already been submitted.' }, { status: 410 })
  }

  // Mark as opened if first time
  if (tokenData.status === 'pending' || tokenData.status === 'sent') {
    await supabaseAdmin
      .from('intake_tokens')
      .update({ status: 'opened', opened_at: new Date().toISOString() })
      .eq('id', tokenData.id)
  }

  return NextResponse.json({
    id: tokenData.id,
    practice_id: tokenData.practice_id,
    patient_name: tokenData.patient_name,
    patient_phone: tokenData.patient_phone,
    patient_email: tokenData.patient_email,
    practice: tokenData.practices,
  })
}
