// FILE: app/api/intake/send/route.ts
// FIX: Use intake_forms table (which submit route reads from) instead of intake_tokens
// FIX: Link intake_forms to patient_id directly so intake is always tied to a patient
// Also generates token via crypto since intake_forms.token has no default

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import twilio from 'twilio'
import crypto from 'crypto'
import { sendPatientEmail, buildIntakeEmail } from '@/lib/email'
import { logCommunication } from '@/lib/patientCommunications'

// POST /api/intake/send
// Called by the webhook after a new patient call, or manually from dashboard
// Creates an intake_forms record linked to the patient and sends the link via SMS and/or email
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    let {
      practice_id,
      patient_id,
      call_log_id,
      patient_phone,
      patient_email,
      patient_name,
      delivery_method, // 'sms' | 'email' | 'both'
    } = body

    // If practice_id not provided, look it up from patient record
    if (!practice_id && patient_id) {
      const { data: patientRecord } = await supabaseAdmin
        .from('patients')
        .select('practice_id')
        .eq('id', patient_id)
        .single()
      if (patientRecord) {
        practice_id = patientRecord.practice_id
      }
    }

    if (!practice_id) {
      return NextResponse.json({ error: 'Missing practice_id and could not derive from patient' }, { status: 400 })
    }
    if (!patient_phone && !patient_email) {
      return NextResponse.json(
        { error: 'Need at least a phone or email to send intake forms' },
        { status: 400 }
      )
    }

    // Get practice info for the message
    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('name, ai_name')
      .eq('id', practice_id)
      .single()

    if (!practice) {
      return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
    }

    // Generate a secure random token
    const token = crypto.randomBytes(32).toString('hex')

    // Calculate expiry (7 days from now)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    // Create the intake form record in intake_forms table
    // FIX: Include patient_id so the intake form is directly linked to the patient record
    const { data: formData, error: formError } = await supabaseAdmin
      .from('intake_forms')
      .insert({
        token,
        practice_id,
        patient_id: patient_id || null,  // Direct link to patient record
        patient_name: patient_name || null,
        patient_phone: patient_phone || null,
        patient_email: patient_email || null,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString(),
      })
      .select('id, token')
      .single()

    if (formError || !formData) {
      console.error('[Intake] Failed to create intake form:', formError)
      return NextResponse.json({ error: 'Failed to create intake link' }, { status: 500 })
    }

    // Also create a tracking record in intake_tokens (for delivery tracking)
    const { error: tokenError } = await supabaseAdmin
      .from('intake_tokens')
      .insert({
        practice_id,
        patient_id: patient_id || null,
        call_log_id: call_log_id || null,
        patient_phone: patient_phone || null,
        patient_email: patient_email || null,
        patient_name: patient_name || null,
        delivery_method: delivery_method || 'sms',
        status: 'pending',
      })

    if (tokenError) {
      console.warn('[Intake] Failed to create tracking token (non-fatal):', tokenError.message)
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
    const intakeUrl = `${baseUrl}/intake/${token}`
    const practiceName = practice.name || 'the practice'
    const firstName = patient_name?.split(' ')[0] || 'there'

    // Normalize delivery_method. If the caller didn't specify, send via every
    // channel we have contact info for. Previously this defaulted to 'sms',
    // which silently dropped email-only patients.
    const effectiveMethod: 'sms' | 'email' | 'both' =
      delivery_method === 'sms' || delivery_method === 'email' || delivery_method === 'both'
        ? delivery_method
        : patient_phone && patient_email
          ? 'both'
          : patient_email
            ? 'email'
            : 'sms'

    let smsSent = false
    let emailSent = false

    // Send via SMS
    if ((effectiveMethod === 'sms' || effectiveMethod === 'both') && patient_phone) {
      try {
        await sendIntakeSMS(patient_phone, firstName, practiceName, intakeUrl)
        smsSent = true
        console.log(`[Intake] SMS sent to ${patient_phone}`)
      } catch (err) {
        console.error('[Intake] SMS failed:', err)
      }
    }

    // Send via email
    if ((effectiveMethod === 'email' || effectiveMethod === 'both') && patient_email) {
      try {
        await sendIntakeEmail(practice_id, patient_email, firstName, practiceName, intakeUrl)
        emailSent = true
        console.log(`[Intake] Email sent to ${patient_email}`)
      } catch (err) {
        console.error('[Intake] Email failed:', err)
      }
    }

    // Update intake_forms with email tracking
    if (emailSent) {
      await supabaseAdmin
        .from('intake_forms')
        .update({ email_sent: true, email_sent_at: new Date().toISOString() })
        .eq('id', formData.id)
    }

    // Update intake_tokens status
    if (smsSent || emailSent) {
      await supabaseAdmin
        .from('intake_tokens')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('practice_id', practice_id)
        .eq('patient_phone', patient_phone || '')
        .is('sent_at', null)
    }

    // Mark call log as intake sent
    if (call_log_id) {
      await supabaseAdmin
        .from('call_logs')
        .update({
          intake_sent: true,
          intake_delivery_preference: delivery_method || 'sms',
          intake_email: patient_email || null,
        })
        .eq('id', call_log_id)
    }

    // Tier 2B: Log intake delivery to patient_communications
    if (smsSent) {
      logCommunication({
        practiceId: practice_id,
        patientId: patient_id || null,
        patientPhone: patient_phone || null,
        channel: 'sms',
        direction: 'outbound',
        contentSummary: `Intake form sent via SMS to ${firstName}`,
        metadata: { intake_form_id: formData.id, delivery_type: 'intake' },
      })
    }
    if (emailSent) {
      logCommunication({
        practiceId: practice_id,
        patientId: patient_id || null,
        patientEmail: patient_email || null,
        channel: 'email',
        direction: 'outbound',
        contentSummary: `Intake form sent via email to ${firstName}`,
        metadata: { intake_form_id: formData.id, delivery_type: 'intake' },
      })
    }

    console.log(`[Intake] Delivery complete: sms=${smsSent}, email=${emailSent}, form_id=${formData.id}, patient_id=${patient_id || '(none)'}`)

    return NextResponse.json({
      success: true,
      form_id: formData.id,
      intake_url: intakeUrl,
      sms_sent: smsSent,
      email_sent: emailSent,
    })
  } catch (error) {
    console.error('[Intake] Send error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// -- SMS delivery via Twilio --
async function sendIntakeSMS(
  phone: string,
  firstName: string,
  practiceName: string,
  intakeUrl: string
) {
  if (
    !process.env.TWILIO_ACCOUNT_SID ||
    !process.env.TWILIO_AUTH_TOKEN ||
    !process.env.TWILIO_PHONE_NUMBER
  ) {
    throw new Error('Twilio credentials not configured')
  }

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

  await client.messages.create({
    to: phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    body: `Harbor: Hi ${firstName}! Thanks for calling ${practiceName}. Here's a link to your new patient intake forms â just tap to get started:\n\n${intakeUrl}\n\nThe link is valid for 7 days. Reply STOP to opt out.`,
  })
}

// -- Email delivery via Resend (uses shared @/lib/email helpers) --
async function sendIntakeEmail(
  practiceId: string,
  email: string,
  firstName: string,
  practiceName: string,
  intakeUrl: string
) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('Resend API key not configured')
  }

  const { subject, html, from } = buildIntakeEmail({
    practiceName,
    patientName: firstName,
    intakeUrl,
  })

  // Gated by the practice's email opt-out list.
  const { sent, skipped } = await sendPatientEmail({
    practiceId,
    to: email,
    subject,
    html,
    from: `${practiceName} <${from}>`,
  })

  if (!sent && skipped !== 'opted_out') {
    throw new Error('Resend send failed (see server logs)')
  }
}
