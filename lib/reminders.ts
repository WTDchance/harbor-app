// Appointment reminder helpers
// Called from API routes — NOT a Next.js route directly

import { supabaseAdmin } from '@/lib/supabase'
import { sendSMS } from '@/lib/twilio'

/**
 * Send 48-hour appointment reminders
 * Run this daily, e.g. POST /api/reminders/run?type=48hr
 */
export async function send48HourReminders() {
  const targetDate = new Date()
  targetDate.setHours(targetDate.getHours() + 48)

  return sendRemindersForDate(targetDate, 48)
}

/**
 * Send 24-hour appointment reminders
 * Run this daily, e.g. POST /api/reminders/run?type=24hr
 */
export async function send24HourReminders() {
  const targetDate = new Date()
  targetDate.setHours(targetDate.getHours() + 24)

  return sendRemindersForDate(targetDate, 24)
}

async function sendRemindersForDate(targetDate: Date, hoursAhead: number) {
  const startOfWindow = new Date(targetDate)
  startOfWindow.setMinutes(0, 0, 0)

  const endOfWindow = new Date(targetDate)
  endOfWindow.setMinutes(59, 59, 999)

  console.log(`📅 Sending ${hoursAhead}hr reminders for ${startOfWindow.toISOString()}`)

  const { data: appointments, error } = await supabaseAdmin
    .from('appointments')
    .select(`
      id, scheduled_at, appointment_type, status,
      patients (first_name, last_name, phone),
      practices (name, ai_name, phone_number)
    `)
    .gte('scheduled_at', startOfWindow.toISOString())
    .lte('scheduled_at', endOfWindow.toISOString())
    .eq('status', 'scheduled')
    .eq(`reminder_${hoursAhead}hr_sent`, false)

  if (error || !appointments) {
    console.error('Error fetching appointments for reminders:', error)
    return { sent: 0, errors: 1 }
  }

  console.log(`Found ${appointments.length} appointments for ${hoursAhead}hr reminders`)

  let sent = 0
  let errors = 0

  for (const appt of appointments) {
    const patient = (appt as any).patients
    const practice = (appt as any).practices

    if (!patient?.phone) {
      console.warn(`Skipping appt ${appt.id} — no patient phone`)
      continue
    }

    const apptTime = new Date(appt.scheduled_at).toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })

    const aiName = practice?.ai_name || 'your care team'
    const practiceName = practice?.name || 'us'
    const firstName = patient.first_name || 'there'

    const message = hoursAhead === 48
      ? `Harbor Receptionist: Hi ${firstName}! This is a reminder from ${practiceName} — you have an appointment in 2 days on ${apptTime}. Reply CONFIRM to confirm, CANCEL to cancel, or RESCHEDULE if you need a different time. Reply HERE when you arrive and we'll let your therapist know!`
      : `Harbor Receptionist: Hi ${firstName}! Quick reminder from ${practiceName} — your appointment is tomorrow at ${apptTime}. Reply CONFIRM, CANCEL, or RESCHEDULE. For in-person visits, reply HERE when you arrive and we'll notify your therapist. See you soon! — ${aiName}`

    try {
      await sendSMS(patient.phone, message)

      // Mark reminder as sent
      await supabaseAdmin
        .from('appointments')
        .update({ [`reminder_${hoursAhead}hr_sent`]: true })
        .eq('id', appt.id)

      sent++
      console.log(`✓ ${hoursAhead}hr reminder sent to ${patient.first_name} ${patient.last_name}`)
    } catch (err) {
      console.error(`Error sending reminder to ${patient.phone}:`, err)
      errors++
    }
  }

  return { sent, errors }
}

/**
 * Handle incoming CONFIRM / CANCEL / RESCHEDULE replies
 */
export async function handleReminderReply(
  patientPhone: string,
  message: string,
  practiceId: string
) {
  const upper = message.trim().toUpperCase()

  if (upper === 'CONFIRM' || upper === 'YES') {
    // Mark next upcoming appointment as confirmed
    const { data: appointment } = await supabaseAdmin
      .from('appointments')
      .select('id, scheduled_at, practices(name, ai_name)')
      .eq('practice_id', practiceId)
      .eq('status', 'scheduled')
      .gte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .single()

    if (appointment) {
      await supabaseAdmin
        .from('appointments')
        .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
        .eq('id', appointment.id)

      const practice = (appointment as any).practices
      const aiName = practice?.ai_name || 'Ellie'
      return `Perfect, you're all set! See you then. — ${aiName}`
    }
    return `Got it, confirmed! See you at your appointment.`
  }

  if (upper === 'CANCEL') {
    const { data: appointment } = await supabaseAdmin
      .from('appointments')
      .select('id, scheduled_at, practice_id, practices(name, ai_name, notification_email)')
      .eq('practice_id', practiceId)
      .eq('status', 'scheduled')
      .gte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .single()

    if (appointment) {
      const practice = (appointment as any).practices
      const aiName = practice?.ai_name || 'Ellie'

      await supabaseAdmin
        .from('appointments')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', appointment.id)

      // Trigger cancellation fill — find patients to offer the slot
      const slotTime = new Date((appointment as any).scheduled_at).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
      })

      // Call fill endpoint internally
      try {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/cancellation/fill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            practiceId: appointment.practice_id,
            appointmentId: appointment.id,
            slotTime,
          }),
        })
      } catch (err) {
        console.error('Error triggering cancellation fill:', err)
      }

      return `Okay, I've cancelled your appointment. We'll reach out soon to reschedule if you'd like. — ${aiName}`
    }
    return `Got it — appointment cancelled. Call us if you'd like to reschedule.`
  }

  if (upper === 'RESCHEDULE') {
    const { data: appointment } = await supabaseAdmin
      .from('appointments')
      .select('id, practices(name, ai_name, phone_number)')
      .eq('practice_id', practiceId)
      .eq('status', 'scheduled')
      .gte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .single()

    if (appointment) {
      const practice = (appointment as any).practices
      const aiName = practice?.ai_name || 'Ellie'
      const practicePhone = practice?.phone_number

      await supabaseAdmin
        .from('appointments')
        .update({ status: 'reschedule_requested' })
        .eq('id', appointment.id)

      return practicePhone
        ? `Sure! Give us a call at ${practicePhone} and we'll get you a new time that works. — ${aiName}`
        : `Sure! We'll reach out soon to find a new time that works for you. — ${aiName}`
    }
    return `We'll reach out to find a new time for you.`
  }

  // Non-keyword reply — pass to AI handler
  return null
}
