import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import twilio from 'twilio'

// POST /api/intake/send
// Called by the voice server after a new patient call, or manually from dashboard
// Creates an intake token and sends the link via SMS and/or email
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      practice_id,
      patient_id,
      call_log_id,
      patient_phone,
      patient_email,
      patient_name,
      delivery_method, // 'sms' | 'email' | 'both'
    } = body

    if (!practice_id) {
      return NextResponse.json({ error: 'Missing practice_id' }, { status: 400 })
    }

    if (!patient_phone && !patient_email) {
      return NextResponse.json({ error: 'Need at least a phone or email to send intake forms' }, { status: 400 })
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

    // Create the token
    const { data: tokenData, error: tokenError } = await supabaseAdmin
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
      .select('id, token')
      .single()

    if (tokenError || !tokenData) {
      console.error('Failed to create intake token:', tokenError)
      return NextResponse.json({ error: 'Failed to create intake link' }, { status: 500 })
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
    const intakeUrl = `${baseUrl}/intake/${tokenData.token}`
    const practiceName = practice.name || 'the practice'
    const firstName = patient_name?.split(' ')[0] || 'there'

    let smsSent = false
    let emailSent = false

    // Send via SMS
    if ((delivery_method === 'sms' || delivery_method === 'both') && patient_phone) {
      try {
        await sendIntakeSMS(patient_phone, firstName, practiceName, intakeUrl)
        smsSent = true
        console.log(`✓ Intake SMS sent to ${patient_phone}`)
      } catch (err) {
        console.error('Intake SMS failed:', err)
      }
    }

    // Send via email
    if ((delivery_method === 'email' || delivery_method === 'both') && patient_email) {
      try {
        await sendIntakeEmail(patient_email, firstName, practiceName, intakeUrl)
        emailSent = true
        console.log(`✓ Intake email sent to ${patient_email}`)
      } catch (err) {
        console.error('Intake email failed:', err)
      }
    }

    // Update token status
    if (smsSent || emailSent) {
      await supabaseAdmin
        .from('intake_tokens')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', tokenData.id)
    }

    // Mark call log as intake sent
    if (call_log_id) {
      await supabaseAdmin
        .from('call_logs')
        .update({ intake_sent: true })
        .eq('id', call_log_id)
    }

    return NextResponse.json({
      success: true,
      token_id: tokenData.id,
      intake_url: intakeUrl,
      sms_sent: smsSent,
      email_sent: emailSent,
    })
  } catch (error) {
    console.error('Intake send error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── SMS delivery via Twilio ──
async function sendIntakeSMS(phone: string, firstName: string, practiceName: string, intakeUrl: string) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
    throw new Error('Twilio credentials not configured')
  }

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

  await client.messages.create({
    to: phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    body: `Hi ${firstName}! Thanks for calling ${practiceName}. Here's a link to your new patient intake forms — just tap to get started:\n\n${intakeUrl}\n\nThe link is valid for 7 days. Reply STOP to opt out.`,
  })
}

// ── Email delivery via Resend ──
async function sendIntakeEmail(email: string, firstName: string, practiceName: string, intakeUrl: string) {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    throw new Error('Resend API key not configured')
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'intake@harborreceptionist.com'

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
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
            <a href="${intakeUrl}" style="background: #4f8a6e; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 500; font-size: 16px; display: inline-block;">
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
