// Appointment reminder helpers
// Called from cron jobs or admin triggers — NOT a Next.js route

import { supabaseAdmin } from '@/lib/supabase'
import { sendSMS } from '@/lib/twilio'

/**
 * Send appointment reminders to all upcoming appointments
 * Can be triggered from an API route (POST /api/reminders/run) or cron job
 */
export async function sendAppointmentReminders() {
  try {
    console.log('📅 Checking for appointments to remind...')

    // Get appointments scheduled for tomorrow
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)

    const endOfTomorrow = new Date(tomorrow)
    endOfTomorrow.setHours(23, 59, 59, 999)

    const { data: appointments, error } = await supabaseAdmin
      .from('appointments')
      .select('*, patients(*), practices(*)')
      .gte('scheduled_at', tomorrow.toISOString())
      .lte('scheduled_at', endOfTomorrow.toISOString())
      .eq('status', 'scheduled')

    if (error || !appointments) {
      console.error('Error fetching appointments:', error)
      return
    }

    console.log(`Found ${appointments.length} appointments to remind`)

    for (const appt of appointments) {
      const patient = appt.patients
      const practice = appt.practices

      if (!patient?.phone || !practice?.phone_number) {
        console.warn('Skipping appointment - missing phone info')
        continue
      }

      const appointmentTime = new Date(appt.scheduled_at).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })

      const reminderMessage = `Hi ${patient.first_name}! Just a reminder about your appointment tomorrow at ${appointmentTime} with ${practice.name}. Reply YES to confirm or call us if you need to reschedule.`

      try {
        await sendSMS(patient.phone, reminderMessage)
        console.log(`✓ Reminder sent to ${patient.phone}`)
      } catch (err) {
        console.error(`Error sending reminder to ${patient.phone}:`, err)
      }
    }
  } catch (error) {
    console.error('Error in sendAppointmentReminders:', error)
  }
}
