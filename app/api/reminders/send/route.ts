import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendSMS } from '@/lib/twilio'

const REMINDER_SECRET = process.env.REMINDER_SECRET
const REMINDER_MESSAGE =
  "Hi! Just a reminder that you have an appointment tomorrow. Reply STOP to opt out of reminders."

async function handleReminders(request: NextRequest) {
  // Protect with secret header — only authorized cron callers can trigger this
  const authHeader = request.headers.get('x-reminder-secret')
  if (REMINDER_SECRET && authHeader !== REMINDER_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Target date: tomorrow in UTC (appointments are stored as YYYY-MM-DD strings)
    const tomorrow = new Date()
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]

    // Fetch tomorrow's appointments that haven't had a reminder sent
    // and haven't opted out
    const { data: appointments, error: fetchError } = await supabaseAdmin
      .from('appointments')
      .select('id, patient_phone, appointment_date, appointment_time')
      .eq('appointment_date', tomorrowStr)
      .is('reminder_sent_at', null)
      .eq('reminder_opted_out', false)

    if (fetchError) {
      console.error('Failed to fetch appointments:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch appointments' }, { status: 500 })
    }

    if (!appointments || appointments.length === 0) {
      console.log(`No reminders to send for ${tomorrowStr}`)
      return NextResponse.json({ sent: 0, date: tomorrowStr, message: 'No reminders to send' })
    }

    let sent = 0
    const errors: string[] = []

    for (const appt of appointments) {
      if (!appt.patient_phone) {
        console.log(`Skipping appointment ${appt.id} — no patient phone`)
        continue
      }

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
          console.log(`Reminder sent for appointment ${appt.id} on ${appt.appointment_date}`)
        }
      } catch (smsErr) {
        console.error(`Failed to send SMS for appointment ${appt.id}:`, smsErr)
        errors.push(appt.id)
      }
    }

    return NextResponse.json({
      sent,
      date: tomorrowStr,
      total: appointments.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Sent ${sent} of ${appointments.length} reminder(s)`,
    })
  } catch (error) {
    console.error('Reminder cron error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — primary endpoint for cron jobs (Railway, Vercel Cron, etc.)
export async function POST(request: NextRequest) {
  return handleReminders(request)
}

// GET — fallback for cron services that only support GET
export async function GET(request: NextRequest) {
  return handleReminders(request)
}
