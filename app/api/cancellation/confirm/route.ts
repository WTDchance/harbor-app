import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendEmail } from '@/lib/email'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const from = formData.get('From') as string
    const body = (formData.get('Body') as string)?.trim().toUpperCase()

    // Find active fill offer for this phone number
    const { data: patient } = await supabaseAdmin
      .from('waitlist')
      .select('*, practices(name, notification_email, therapist_name)')
      .eq('patient_phone', from)
      .eq('status', 'fill_offered')
      .single()

    const twiml = (msg: string) =>
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg}</Message></Response>`

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
