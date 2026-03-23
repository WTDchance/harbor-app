import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendSMS } from '@/lib/twilio'

const REMINDER_SECRET = process.env.REMINDER_SECRET
const REMINDER_MESSAGE =
  "Hi! Just a reminder that you have an appointment tomorrow. Reply STOP to opt out of reminders."

async function handleReminders(request: NextRequest) {
  // Protect with secret header
  const authHeader = request.headers.get('x-reminder-secret')
  if (REMINDER_SECRET && authHeader !== REMINDER_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Find appointments 24 hours from now (within a 15-minute window)
    const now = new Date()
    const windowStart = new Date(now.getTime() + 24 * 60 * 60 * 1000 - 7.5 * 60 * 1000)
    const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 7.5 * 60 * 1000)

    const { data: appointments, error: fetchError } = await supabaseAdmin
      .from('appointments')
      .select('id, patient_phone, appointment_time')
      .gte('appointment_time', windowStart.toISOString())
      .lte('appointment_time', windowEnd.toISOString())
      .is('reminder_sent_at', null)
      .eq('reminder_opted_out', false)

    if (fetchError) {
      console.error('Failed to fetch appointments:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch appointments' }, { status: 500 })
    }

    if (!appointments || appointments.length === 0) {
      return NextResponse.json({ sent: 0, message: 'No reminders to send' })
    }

    let sent = 0
    const errors: string[] = []

    for (const appt of appointments) {
      if (!appt.patient_phone) continue

      try {
        await sendSMS(appt.patient_phone, REMINDER_MESSAGE)

        const { error: updateError } = await supabaseAdmin
          .from('appointments')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', appt.id)

        if (updateError) {
          console.error(`Failed to update reminder_sent_at for ${appt.id}:`, updateError)
          errors.push(appt.id)
        } else {
          sent++
        }
      } catch (smsErr) {
        console.error(`Failed to send SMS for appointment ${appt.id}:`, smsErr)
        errors.push(appt.id)
      }
    }

    return NextResponse.json({
      sent,
      errors: errors.length > 0 ? errors : undefined,
      message: `Sent ${sent} reminder(s)`,
    })
  } catch (error) {
    console.error('Reminder cron error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — primary endpoint for cron jobs
export async function POST(request: NextRequest) {
  return handleReminders(request)
}

// GET — fallback for cron services that use GET requests
export async function GET(request: NextRequest) {
  return handleReminders(request)
}
