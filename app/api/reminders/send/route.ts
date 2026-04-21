// FILE: app/api/reminders/send/route.ts
// Sends appointment reminders via SMS and/or EMAIL
// Triggered by cron job (Railway cron, external scheduler)
// - SMS: sent via Twilio (when patient has phone and A2P is registered)
// - Email: sent via Resend (when patient has email)

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendSMS } from '@/lib/twilio'
import { sendReminderEmail } from '@/lib/reminder-email'
import { checkSmsConsent } from '@/lib/sms-consent'

const REMINDER_SECRET = process.env.REMINDER_SECRET
// Set to 'email' to only send email, 'sms' for only SMS, 'both' for both
const REMINDER_CHANNEL = process.env.REMINDER_CHANNEL || 'both'

async function handleReminders(request: NextRequest) {
  // Protect with secret header — only authorized cron callers can trigger this
  const authHeader = request.headers.get('x-reminder-secret')
  if (REMINDER_SECRET && authHeader !== REMINDER_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Allow override via query param: ?channel=email or ?channel=sms or ?channel=both
  const channelOverride = request.nextUrl.searchParams.get('channel')
  const channel = channelOverride || REMINDER_CHANNEL

  try {
    // Target date: tomorrow in UTC
    const tomorrow = new Date()
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]

    const { data: practices, error: practicesError } = await supabaseAdmin
      .from('practices')
      .select('id, name, phone_number, address')

    if (practicesError) {
      console.error('Failed to fetch practices:', practicesError)
      return NextResponse.json({ error: 'Failed to fetch practices' }, { status: 500 })
    }

    let totalSmsSent = 0
    let totalEmailSent = 0
    let totalAppointments = 0
    const practiceResults: {
      practice_id: string
      sms_sent: number
      email_sent: number
      total: number
      errors: string[]
    }[] = []

    for (const practice of practices || []) {
      const { data: appointments, error: fetchError } = await supabaseAdmin
        .from('appointments')
        .select(`
          id, appointment_date, appointment_time, patient_id, provider_name,
          patients!inner(phone, email, first_name),
          practices!inner(name, phone_number, address)
        `)
        .eq('practice_id', practice.id)
        .eq('appointment_date', tomorrowStr)
        .is('reminder_sent_at', null)
        .eq('reminder_opted_out', false)
        .neq('status', 'cancelled')

      if (fetchError) {
        console.error(`Failed to fetch appointments for practice ${practice.id}:`, fetchError)
        practiceResults.push({
          practice_id: practice.id,
          sms_sent: 0,
          email_sent: 0,
          total: 0,
          errors: [fetchError.message],
        })
        continue
      }

      if (!appointments || appointments.length === 0) continue

      let smsSent = 0
      let emailSent = 0
      const errors: string[] = []

      for (const appt of appointments) {
        const patient = (appt as any).patients
        const practiceData = (appt as any).practices
        const practiceName = practiceData?.name || practice.name
        const practicePhone = practiceData?.phone_number || practice.phone_number
        const practiceAddress = practiceData?.address || practice.address
        const firstName = patient?.first_name || 'there'
        let reminderSent = false

        // Format time for display
        const timeStr = appt.appointment_time ? formatTime(appt.appointment_time) : undefined
        const dateStr = formatDate(appt.appointment_date)

        // --- Send EMAIL reminder ---
        if ((channel === 'email' || channel === 'both') && patient?.email) {
          try {
            const success = await sendReminderEmail(patient.email, {
              patientFirstName: firstName,
              practiceName,
              appointmentDate: dateStr,
              appointmentTime: timeStr,
              providerName: appt.provider_name,
              practicePhone,
              practiceAddress,
            })

            if (success) {
              emailSent++
              reminderSent = true
              console.log(`\u2713 Email reminder sent to ${firstName} at ${patient.email}`)
            } else {
              console.error(`Failed email reminder for appt ${appt.id}`)
              errors.push(`email:${appt.id}`)
            }
          } catch (err) {
            console.error(`Email error for appt ${appt.id}:`, err)
            errors.push(`email:${appt.id}`)
          }
        }

        // --- Send SMS reminder ---
        if ((channel === 'sms' || channel === 'both') && patient?.phone) {
          // HIPAA/TCPA consent gate: appointment reminders include therapist
          // name + time which IS PHI. We only send if the patient has
          // explicitly consented via intake (sms_consent_given_at set) and
          // hasn't subsequently opted out via STOP.
          const consent = await checkSmsConsent(practice.id, patient.phone)
          if (!consent.allowed) {
            console.log(
              `[reminders] SMS skipped for appt ${appt.id} — reason=${consent.reason} (patient ${consent.patientId ?? '?'})`
            )
          } else {
            try {
              const timeDisplay = timeStr ? ` at ${timeStr}` : ''
              const greeting = patient.first_name ? `Hi ${patient.first_name}!` : 'Hi!'
              const message = `${greeting} This is a reminder of your appointment with ${practiceName} tomorrow${timeDisplay}. Reply STOP to opt out.`

              await sendSMS(patient.phone, message, practice.id)
              smsSent++
              reminderSent = true
              console.log(`\u2713 SMS reminder sent to ${firstName}`)
            } catch (smsErr) {
              console.error(`SMS error for appt ${appt.id}:`, smsErr)
              errors.push(`sms:${appt.id}`)
            }
          }
        }

        // Mark as sent if at least one channel succeeded
        if (reminderSent) {
          const { error: updateError } = await supabaseAdmin
            .from('appointments')
            .update({ reminder_sent_at: new Date().toISOString() })
            .eq('id', appt.id)

          if (updateError) {
            console.error(`Failed to update reminder_sent_at for ${appt.id}:`, updateError)
          }
        }
      }

      totalSmsSent += smsSent
      totalEmailSent += emailSent
      totalAppointments += appointments.length
      practiceResults.push({
        practice_id: practice.id,
        sms_sent: smsSent,
        email_sent: emailSent,
        total: appointments.length,
        errors: errors.length > 0 ? errors : [],
      })
    }

    return NextResponse.json({
      channel,
      date: tomorrowStr,
      total_appointments: totalAppointments,
      sms_sent: totalSmsSent,
      email_sent: totalEmailSent,
      practices: practiceResults.length,
      message: `Sent ${totalSmsSent} SMS + ${totalEmailSent} email reminder(s) for ${totalAppointments} appointment(s) across ${practiceResults.length} practice(s)`,
    })
  } catch (error) {
    console.error('Reminder cron error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Helper to format "14:30:00" \u2192 "2:30 PM"
function formatTime(timeStr: string): string {
  try {
    const [hours, minutes] = timeStr.split(':').map(Number)
    const ampm = hours >= 12 ? 'PM' : 'AM'
    const displayHour = hours % 12 || 12
    return `${displayHour}:${minutes.toString().padStart(2, '0')} ${ampm}`
  } catch {
    return timeStr
  }
}

// Helper to format "2026-04-04" \u2192 "Friday, April 4"
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T12:00:00')
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

export async function POST(request: NextRequest) {
  return handleReminders(request)
}

export async function GET(request: NextRequest) {
  return handleReminders(request)
}
