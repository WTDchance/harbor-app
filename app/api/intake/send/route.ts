// FILE: app/api/intake/send/route.ts
// FIX: Use intake_forms table (which submit route reads from) instead of intake_tokens
// FIX: Link intake_forms to patient_id directly so intake is always tied to a patient
// Also generates token via crypto since intake_forms.token has no default

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import twilio from 'twilio'
import crypto from 'crypto'

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

    let smsSent = false
    let emailSent = false

    // Send via SMS
    if ((delivery_method === 'sms' || delivery_method === 'both' || !delivery_method) && patient_phone) {
      try {
        await sendIntakeSMS(patient_phone, firstName, practiceName, intakeUrl)
        smsSent = true
        console.log(`[Intake] SMS sent to ${patient_phone}`)
      } catch (err) {
        console.error('[Intake] SMS failed:', err)
      }
    }

    // Send via email
    if ((delivery_method === 'email' || delivery_method === 'both') && patient_email) {
      try {
        await sendIntakeEmail(patient_email, firstName, practiceName, intakeUrl)
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
    body: `Hi ${firstName}! Thanks for calling ${practiceName}. Here's a link to your new patient intake forms â just tap to get started:\n\n${intakeUrl}\n\nThe link is valid for 7 days. Reply STOP to opt out.`,
  })
}

// -- Email delivery via Resend --
async function sendIntakeEmail(
  email: string,
  firstName: string,
  practiceName: string,
  intakeUrl: string
) {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    throw new Error('Resend API key not configured')
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'intake@harborreceptionist.com'

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${practiceName} <${fromEmail}>`,
      to: email,
      subject: `Your intake forms from ${practiceName}`,
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1a1a2e; margin-bottom: 8px;">Welcome, ${firstName}!</h2>
          <p style="color: #4b5563; line-height: 1.6;">
            Thanks for calling ${practiceName}. To get you started, please complete your new patient intake forms using the link below.
          </p>
          <div style="text-align: center; margin: 28px 0;">
            <a href="${intakeUrl}"
               style="background: #4f8a6e; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 500; font-size: 16px; display: inline-block;">
              Complete Intake Forms
            </a>
          </div>
          <p style="color: #6b7280; font-size: 14px; line-height: 1.5;">
            The forms include a brief health questionnaire, your contact and insurance details, and consent forms. It usually takes about 10-15 minutes.
          </p>
          <p style="color: #9ca3af; font-size: 13px; margin-top: 24px;">
            This link is valid for 7 days. If you have any questions, call ${practiceName} directly.
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">
            Sent by Harbor AI on behalf of ${practiceName}
          </p>
        </div>
      `,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(`Resend API error: ${response.status} ${JSON.stringify(errorData)}`)
  }
}
