import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { sendSMS } from '@/lib/twilio'
import { sendPatientEmail, buildIntakeEmail } from '@/lib/email'
import { randomBytes } from 'crypto'

function generateToken(): string {
  return randomBytes(20).toString('hex')
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const {
      appointment_id,
      patient_name,
      patient_phone,
      patient_email,
      questionnaire_type = 'phq9_gad7',
    } = body

    if (!appointment_id || (!patient_phone && !patient_email)) {
      return NextResponse.json(
        { error: 'appointment_id and at least one of patient_phone or patient_email are required' },
        { status: 400 }
      )
    }

    // Look up practice by notification_email (matches dashboard auth pattern)
    const { data: practice } = await supabase
      .from('practices')
      .select('id, name, provider_name, intake_enabled')
      .eq('notification_email', user.email)
      .single()

    if (!practice) {
      return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
    }

    if (practice.intake_enabled === false) {
      return NextResponse.json({ sent: false, message: 'Intake forms disabled for this practice' })
    }

    const token = generateToken()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    const { data: intake, error: intakeError } = await supabase
      .from('intake_forms')
      .insert({
        token,
        practice_id: practice.id,
        appointment_id,
        patient_name: patient_name || null,
        patient_phone: patient_phone || null,
        patient_email: patient_email || null,
        questionnaire_type,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (intakeError) {
      console.error('Failed to create intake form:', intakeError)
      return NextResponse.json({ error: 'Failed to create intake form' }, { status: 500 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
    const intakeUrl = `${appUrl}/intake/${token}`

    let smsSent = false
    let emailSent = false

    // Send SMS if phone provided
    if (patient_phone) {
      const patientLabel = patient_name ? `Hi ${patient_name}` : 'Hi there'
      const smsMessage = [
        `${patientLabel}, ${practice.provider_name || practice.name} sent you a brief intake form to complete before your first appointment.`,
        '',
        `Takes ~2 min: ${intakeUrl}`,
        '',
        'Your responses go directly to your therapist.',
      ].join('\n')
      try {
        await sendSMS(patient_phone, smsMessage)
        smsSent = true
      } catch (err) {
        console.error('Failed to send intake SMS:', err)
      }
    }

    // Send email if email address provided
    if (patient_email) {
      const { subject, html } = buildIntakeEmail({
        practiceName: practice.name,
        providerName: practice.provider_name,
        patientName: patient_name,
        intakeUrl,
      })
      const res = await sendPatientEmail({ practiceId: practice.id, to: patient_email, subject, html })
      emailSent = res.sent
    }

    await supabase
      .from('intake_forms')
      .update({
        sms_sent: smsSent,
        sms_sent_at: smsSent ? new Date().toISOString() : null,
        email_sent: emailSent,
        email_sent_at: emailSent ? new Date().toISOString() : null,
      })
      .eq('id', intake.id)

    return NextResponse.json({
      created: true,
      intake_id: intake.id,
      token,
      intake_url: intakeUrl,
      sms_sent: smsSent,
      email_sent: emailSent,
      expires_at: expiresAt.toISOString(),
    })
  } catch (error) {
    console.error('Intake create error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
