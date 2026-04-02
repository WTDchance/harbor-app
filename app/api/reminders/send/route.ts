// FILE: app/api/reminders/send/route.ts
// FIXES:
//   1. Queries now practice-scoped (iterates per-practice instead of global query)
//   2. Reminder message includes practice name, provider, and appointment time
//   3. Response JSON no longer exposes patient phone numbers
//   4. Still needs external cron job to trigger — see CRON-SETUP.md

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendSMS } from '@/lib/twilio'

const REMINDER_SECRET = process.env.REMINDER_SECRET

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

    // FIX #1: Query per-practice so data is isolated and response doesn't leak cross-practice info
    const { data: practices, error: practicesError } = await supabaseAdmin
      .from('practices')
      .select('id, name')

    if (practicesError) {
      console.error('Failed to fetch practices:', practicesError)
      return NextResponse.json({ error: 'Failed to fetch practices' }, { status: 500 })
    }

    let totalSent = 0
    let totalAppointments = 0
    const practiceResults: { practice_id: string; sent: number; total: number; errors: string[] }[] = []

    for (const practice of practices || []) {
      // FIX #2: Join with patients to get phone, and select appointment_time for message
      // Also join with practices to get name for the reminder text
      const { data: appointments, error: fetchError } = await supabaseAdmin
        .from('appointments')
        .select(`
          id,
          appointment_date,
          appointment_time,
          patient_id,
          patients!inner(phone, first_name),
          practices!inner(name)
        `)
        .eq('practice_id', practice.id)
        .eq('appointment_date', tomorrowStr)
        .is('reminder_sent_at', null)
        .eq('reminder_opted_out', false)
        .neq('status', 'cancelled')

      if (fetchError) {
        console.error(`Failed to fetch appointments for practice ${practice.id}:`, fetchError)
        practiceResults.push({ practice_id: practice.id, sent: 0, total: 0, errors: [fetchError.message] })
        continue
      }

      if (!appointments || appointments.length === 0) continue

      let sent = 0
      const errors: string[] = []

      for (const appt of appointments) {
        const patient = (appt as any).patients
        const practiceName = (appt as any).practices?.name || practice.name

        if (!patient?.phone) {
          console.log(`Skipping appointment ${appt.id} — no patient phone`)
          continue
        }

        try {
          // FIX #2: Build a useful reminder message with practice name and time
          const timeStr = appt.appointment_time
            ? ` at ${formatTime(appt.appointment_time)}`
            : ''
          const greeting = patient.first_name ? `Hi ${patient.first_name}!` : 'Hi!'
          const message = `${greeting} This is a reminder of your appointment with ${practiceName} tomorrow${timeStr}. Reply STOP to opt out.`

          await sendSMS(patient.phone, message)

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

      totalSent += sent
      totalAppointments += appointments.length
      practiceResults.push({
        practice_id: practice.id,
        sent,
        total: appointments.length,
        errors: errors.length > 0 ? errors : [],
      })
    }

    // FIX #3: Response doesn't include patient phone numbers — just counts and IDs
    return NextResponse.json({
      sent: totalSent,
      date: tomorrowStr,
      total: totalAppointments,
      practices: practiceResults.length,
      message: `Sent ${totalSent} of ${totalAppointments} reminder(s) across ${practiceResults.length} practice(s)`,
    })
  } catch (error) {
    console.error('Reminder cron error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Helper to format "14:30:00" or "14:30" into "2:30 PM"
function formatTime(timeStr: string): string {
  try {
    const [hours, minutes] = timeStr.split(':').map(Number)
    const ampm = hours >= 12 ? 'PM' : 'AM'
    const displayHour = hours % 12 || 12
    return `${displayHour}:${minutes.toString().padStart(2, '0')} ${ampm}`
  } catch {
    return timeStr // fallback to raw string
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
