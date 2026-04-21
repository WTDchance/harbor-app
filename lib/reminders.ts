// Appointment reminder helpers
// Called from API routes — NOT a Next.js route directly
//
// Each appointment triggers reminders on two channels when available:
//   - SMS via Twilio (keyword replies: CONFIRM / CANCEL / RESCHEDULE)
//   - Email via Resend (link-based CONFIRM / CANCEL, since email has no
//     reply-keyword shortcut)
// We mark `reminder_{hours}hr_sent = true` if AT LEAST ONE channel succeeds,
// so we don't spam if one channel is misconfigured or the number is still
// stuck in A2P 10DLC review.

import { supabaseAdmin } from '@/lib/supabase'
import { sendSMS } from '@/lib/twilio'
import { sendPatientEmail, EMAIL_SUPPORT } from '@/lib/email'

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
      patients (first_name, last_name, phone, email),
      practices (name, ai_name, phone_number, notification_email)
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

    if (!patient) {
      console.warn(`Skipping appt ${appt.id} — no patient record`)
      continue
    }

    if (!patient.phone && !patient.email) {
      console.warn(`Skipping appt ${appt.id} — patient has no phone or email`)
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

    const smsMessage = hoursAhead === 48
      ? `Harbor: Hi ${firstName}! This is a reminder from ${practiceName} — you have an appointment in 2 days on ${apptTime}. Reply CONFIRM to confirm, CANCEL to cancel, or RESCHEDULE if you need a different time. Reply HERE when you arrive and we'll let your therapist know!`
      : `Harbor: Hi ${firstName}! Quick reminder from ${practiceName} — your appointment is tomorrow at ${apptTime}. Reply CONFIRM, CANCEL, or RESCHEDULE. For in-person visits, reply HERE when you arrive and we'll notify your therapist. See you soon! — ${aiName}`

    let anyChannelSent = false

    // --- SMS ---
    if (patient.phone) {
      try {
        await sendSMS(patient.phone, smsMessage)
        anyChannelSent = true
        console.log(`✓ SMS ${hoursAhead}hr reminder sent to ${patient.phone}`)
      } catch (err) {
        console.error(`SMS reminder failed for ${patient.phone}:`, err)
      }
    }

    // --- Email ---
    if (patient.email) {
      try {
        const { subject, html } = buildReminderEmail({
          firstName,
          practiceName,
          aiName,
          apptTime,
          hoursAhead,
          appointmentId: appt.id,
        })
        const { sent: ok } = await sendPatientEmail({
          practiceId: (appt as any).practice_id,
          to: patient.email,
          subject,
          html,
          from: EMAIL_SUPPORT,
        })
        if (ok) {
          anyChannelSent = true
          console.log(`✓ Email ${hoursAhead}hr reminder sent to ${patient.email}`)
        }
      } catch (err) {
        console.error(`Email reminder failed for ${patient.email}:`, err)
      }
    }

    if (anyChannelSent) {
      await supabaseAdmin
        .from('appointments')
        .update({ [`reminder_${hoursAhead}hr_sent`]: true })
        .eq('id', appt.id)
      sent++
    } else {
      errors++
      console.error(`✗ All reminder channels failed for appt ${appt.id}`)
    }
  }

  return { sent, errors }
}

/**
 * Build the email body for an appointment reminder.
 * Uses link-based CONFIRM/CANCEL because email can't use SMS reply-keywords.
 */
function buildReminderEmail(opts: {
  firstName: string
  practiceName: string
  aiName: string
  apptTime: string
  hoursAhead: number
  appointmentId: string
}): { subject: string; html: string } {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
  const confirmUrl = `${appUrl}/appointments/${opts.appointmentId}/confirm`
  const cancelUrl = `${appUrl}/appointments/${opts.appointmentId}/cancel`

  const subject = opts.hoursAhead === 48
    ? `Your appointment with ${opts.practiceName} is in 2 days`
    : `Reminder: your appointment with ${opts.practiceName} is tomorrow`

  const lead = opts.hoursAhead === 48
    ? `You have an appointment in 2 days on <strong>${opts.apptTime}</strong>.`
    : `Your appointment is tomorrow at <strong>${opts.apptTime}</strong>.`

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f0; margin: 0; padding: 20px; }
.container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.header { background: #0d9488; padding: 24px 32px; color: white; }
.header h1 { margin: 0; font-size: 20px; font-weight: 600; }
.body { padding: 32px; font-size: 15px; line-height: 1.7; color: #333; }
.cta { text-align: center; margin: 24px 0 8px; }
.btn { display: inline-block; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 0 6px; }
.btn-confirm { background: #0d9488; color: white !important; }
.btn-cancel { background: #ffffff; color: #b45309 !important; border: 1px solid #e5d3b0; }
.note { font-size: 13px; color: #999; margin-top: 16px; }
.footer { padding: 20px 32px; background: #f9f9f7; font-size: 12px; color: #999; text-align: center; }
</style></head>
<body>
  <div class="container">
    <div class="header"><h1>📅 Appointment reminder</h1></div>
    <div class="body">
      <p>Hi ${opts.firstName},</p>
      <p>${lead}</p>
      <p>Tap a button below to let ${opts.practiceName} know.</p>
      <div class="cta">
        <a href="${confirmUrl}" class="btn btn-confirm">✓ Confirm</a>
        <a href="${cancelUrl}" class="btn btn-cancel">Cancel</a>
      </div>
      <p class="note">Need to reschedule? Just reply to this email or call ${opts.practiceName} directly.</p>
    </div>
    <div class="footer">Sent by ${opts.aiName} · Harbor AI Receptionist · <a href="https://harborreceptionist.com">harborreceptionist.com</a></div>
  </div>
</body></html>`

  return { subject, html }
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
