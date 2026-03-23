import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { sendSMS } from '@/lib/twilio'
import { randomBytes } from 'crypto'

function generateToken(): string {
  return randomBytes(20).toString('hex')
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { appointment_id, patient_name, patient_phone, questionnaire_type = 'phq9_gad7' } = body

    if (!appointment_id || !patient_phone) {
      return NextResponse.json({ error: 'appointment_id and patient_phone are required' }, { status: 400 })
    }

    const { data: practice } = await supabase
      .from('practices')
      .select('id, name, provider_name, intake_enabled')
      .eq('user_id', user.id)
      .single()

    if (!practice) {
      return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
    }

    if (practice.intake_enabled === false) {
      return NextResponse.json({ sent: false, message: 'Intake forms disabled for this practice' })
    }

    const token = generateToken()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7) // expires in 7 days

    // Store token in DB
    const { data: intake, error: intakeError } = await supabase
      .from('intake_forms')
      .insert({
        token,
        practice_id: practice.id,
        appointment_id,
        patient_name: patient_name || null,
        patient_phone,
        questionnaire_type,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (intakeError) {
      console.error('Failed to create intake form:', intakeError)
      return NextResponse.json({ error: 'Failed to create intake form' }, { status: 500 })
    }

    // Determine app URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
    const intakeUrl = `${appUrl}/intake/${token}`

    // Send SMS to patient
    const patientLabel = patient_name ? `Hi ${patient_name}` : 'Hi'
    const smsMessage = [
      `${patientLabel}, ${practice.provider_name || practice.name} has sent you a brief intake questionnaire to complete before your first appointment.`,
      '',
      `It takes about 2 minutes: ${intakeUrl}`,
      '',
      'Your responses help your therapist prepare for your session.'
    ].join('\n')

    let smsSent = false
    try {
      await sendSMS(patient_phone, smsMessage)
      smsSent = true
    } catch (smsError) {
      console.error('Failed to send intake SMS:', smsError)
    }

    // Update intake form with SMS sent status
    await supabase
      .from('intake_forms')
      .update({ sms_sent: smsSent, sms_sent_at: smsSent ? new Date().toISOString() : null })
      .eq('id', intake.id)

    return NextResponse.json({
      created: true,
      intake_id: intake.id,
      token,
      intake_url: intakeUrl,
      sms_sent: smsSent,
      expires_at: expiresAt.toISOString()
    })

  } catch (error) {
    console.error('Intake create error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
