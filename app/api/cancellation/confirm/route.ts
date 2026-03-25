import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendEmail } from '@/lib/email'
import twilio from 'twilio'
import { triggerCheckinNotification } from '@/lib/kasa'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const from = formData.get('From') as string
    const body = (formData.get('Body') as string)?.trim()

    const twiml = (msg: string) =>
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg}</Message></Response>`

    // Arrival keywords detection
    const ARRIVAL_KEYWORDS = ['here', "i'm here", 'im here', 'arrived', 'arrival', 'checked in', 'check in', 'i am here', 'waiting', 'outside', 'in the parking lot', 'in lobby', 'in the lobby', 'here!', 'arrived!']
    const isArrival = ARRIVAL_KEYWORDS.some(kw => body.toLowerCase().includes(kw))

    if (isArrival) {
      // Look up today's appointment for this phone number
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const { data: reminder } = await supabaseAdmin
        .from('appointment_reminders')
        .select('*, practices(name, therapist_name, therapist_phone, kasa_email, kasa_password, kasa_device_alias, kasa_auto_off_minutes)')
        .eq('patient_phone', from)
        .gte('appointment_time', today.toISOString())
        .order('appointment_time', { ascending: true })
        .limit(1)
        .single()

      if (reminder) {
        const practice = reminder.practices as any
        const apptTime = reminder.appointment_time
          ? new Date(reminder.appointment_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          : 'upcoming'

        // Log arrival
        await supabaseAdmin.from('patient_arrivals').insert({
          practice_id: reminder.practice_id,
          patient_phone: from,
          patient_name: reminder.patient_name,
          appointment_time: reminder.appointment_time,
          therapist_notified: false,
        })

        // Text the therapist
        let therapistNotified = false
        let notificationSid: string | undefined

        if (process.env.TWILIO_ACCOUNT_SID && practice?.therapist_phone) {
          const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
          const msg = await client.messages.create({
            to: practice.therapist_phone,
            from: process.env.TWILIO_PHONE_NUMBER!,
            body: `🏥 ${reminder.patient_name || 'Your patient'} has arrived for their ${apptTime} appointment.`
          })
          therapistNotified = true
          notificationSid = msg.sid
        }

        // Update arrival record
        await supabaseAdmin
          .from('patient_arrivals')
          .update({ therapist_notified: therapistNotified, therapist_notification_sid: notificationSid })
          .eq('patient_phone', from)
          .order('arrived_at', { ascending: false })
          .limit(1)

        // Trigger smart device check-in notification (e.g., turn on a light/plug)
        if (practice?.kasa_email && practice?.kasa_password && practice?.kasa_device_alias) {
          const autoOffMinutes = practice.kasa_auto_off_minutes || 5
          triggerCheckinNotification(
            reminder.practice_id,
            practice.kasa_email,
            practice.kasa_password,
            practice.kasa_device_alias,
            autoOffMinutes
          ).then((result) => {
            if (result.success) {
              console.log(`✓ Smart device "${result.deviceName}" triggered for ${reminder.patient_name}`)
            } else {
              console.warn(`⚠️ Smart device trigger failed: ${result.error}`)
            }
          }).catch((err) => {
            console.error('Smart device trigger error:', err)
          })
        }

        // Reply to patient
        return new Response(
          twiml(`Thanks${reminder.patient_name ? ` ${reminder.patient_name.split(' ')[0]}` : ''}! We've let ${practice?.therapist_name || 'your therapist'} know you're here. They'll be with you shortly. 😊`),
          { headers: { 'Content-Type': 'text/xml' } }
        )
      }

      // No appointment found — friendly fallback
      return new Response(
        twiml("Thanks for letting us know you're here! If you have an appointment today, your therapist will be with you soon. Questions? Reply HELP."),
        { headers: { 'Content-Type': 'text/xml' } }
      )
    }

    // Find active fill offer for this phone number
    const { data: patient } = await supabaseAdmin
      .from('waitlist')
      .select('*, practices(name, notification_email, therapist_name)')
      .eq('patient_phone', from)
      .eq('status', 'fill_offered')
      .single()

    if (!patient) {
      return new Response(
        twiml(
          "We don't have an active slot offer for your number. Call us to get on the waitlist!"
        ),
        {
          headers: { 'Content-Type': 'text/xml' },
        }
      )
    }

    const now = new Date()
    const expires = new Date(patient.offer_expires_at)

    if (body === 'YES') {
      if (now > expires) {
        // Slot expired
        await supabaseAdmin
          .from('waitlist')
          .update({ status: 'waiting' })
          .eq('id', patient.id)

        return new Response(
          twiml(
            "Sorry, that slot was claimed by someone else. You're still on the waitlist and we'll reach out for the next opening!"
          ),
          {
            headers: { 'Content-Type': 'text/xml' },
          }
        )
      }

      // Claim the slot
      await supabaseAdmin
        .from('waitlist')
        .update({ status: 'scheduled', claimed_slot_at: new Date().toISOString() })
        .eq('id', patient.id)

      // Email the therapist
      const slotFormatted = patient.offered_slot
        ? new Date(patient.offered_slot).toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })
        : 'slot time unknown'

      const practice = patient.practices as any
      await sendEmail({
        to: practice.notification_email,
        subject: `✅ Slot Claimed — ${patient.patient_name}`,
        html: `<p><strong>${patient.patient_name}</strong> (${from}) has claimed the ${slotFormatted} appointment slot from the waitlist.</p><p>Please confirm in your calendar system.</p>`,
      })

      return new Response(
        twiml(
          `You're confirmed for ${slotFormatted} at ${practice.name}! ${practice.therapist_name}'s team will send you intake forms shortly. See you then!`
        ),
        {
          headers: { 'Content-Type': 'text/xml' },
        }
      )
    }

    // Any other response — leave on waitlist
    await supabaseAdmin
      .from('waitlist')
      .update({ status: 'waiting' })
      .eq('id', patient.id)

    return new Response(
      twiml(
        "No problem! You're still on the waitlist and we'll reach out when the next slot opens."
      ),
      {
        headers: { 'Content-Type': 'text/xml' },
      }
    )
  } catch (error) {
    console.error('Cancellation confirm error:', error)
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sorry, something went wrong. Please call us.</Message></Response>`,
      {
        headers: { 'Content-Type': 'text/xml' },
      }
    )
  }
}
