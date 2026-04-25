// FILE: app/api/intake/verify/route.ts
// FIX: Query intake_forms table instead of intake_tokens
// The send route writes tokens to intake_forms. The old verify route queried
// intake_tokens which has its own auto-generated token — so it could never
// find tokens created by the send route.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// GET /api/intake/verify?token=abc123
// Public endpoint — validates token and returns practice info for the form
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  // FIX: Read from intake_forms (where the send route writes the token)
  // instead of intake_tokens (which has its own unrelated auto-generated token)
  const { data: formData, error } = await supabaseAdmin
    .from('intake_forms')
    .select(`
      id,
      practice_id,
      patient_name,
      patient_phone,
      patient_email,
      status,
      expires_at,
      created_at,
      practices (
        id,
        name
      )
    `)
    .eq('token', token)
    .single()

  if (error || !formData) {
    return NextResponse.json(
      { error: 'Invalid or expired intake link. Please contact the practice for a new one.' },
      { status: 404 }
    )
  }

  // Check expiry
  if (formData.expires_at && new Date(formData.expires_at) < new Date()) {
    return NextResponse.json(
      { error: 'This intake link has expired. Please contact the practice for a new one.' },
      { status: 410 }
    )
  }

  // Check if already completed
  if (formData.status === 'completed') {
    return NextResponse.json(
      { error: 'This intake form has already been submitted.' },
      { status: 410 }
    )
  }

  // Mark as opened if first time
  if (formData.status === 'pending' || formData.status === 'sent') {
    await supabaseAdmin
      .from('intake_forms')
      .update({ status: 'opened', opened_at: new Date().toISOString() })
      .eq('id', formData.id)

    // Also update the corresponding intake_tokens record if one exists
    // (for tracking purposes — correlate by practice_id + patient_phone)
    if (formData.patient_phone) {
      await supabaseAdmin
        .from('intake_tokens')
        .update({ status: 'opened', opened_at: new Date().toISOString() })
        .eq('practice_id', formData.practice_id)
        .eq('patient_phone', formData.patient_phone)
        .is('opened_at', null)
    }
  }

  return NextResponse.json({
    id: formData.id,
    practice_id: formData.practice_id,
    patient_name: formData.patient_name,
    patient_phone: formData.patient_phone,
    patient_email: formData.patient_email,
    practice: formData.practices,
  })
}
