import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateSMSResponse } from '@/lib/twilio'

// Twilio sends inbound SMS as form-encoded POST requests
// Configure this URL in your Twilio console under Phone Numbers -> Messaging
export async function POST(request: NextRequest) {
  try {
    // Parse Twilio's form-encoded webhook payload
    const formData = await request.formData()
    const from = (formData.get('From') as string) || ''
    const body = (formData.get('Body') as string) || ''
    const messageSid = (formData.get('MessageSid') as string) || ''

    console.log(`Inbound SMS from ${from}: "${body.trim()}" (SID: ${messageSid})`)

    const now = new Date().toISOString()

    // Handle STOP — opt out of all future reminders for this phone number
    if (/\bSTOP\b/i.test(body.trim())) {
      const { error } = await supabaseAdmin
        .from('appointments')
        .update({ reminder_opted_out: true })
        .eq('patient_phone', from)
        .gt('appointment_date', new Date().toISOString().split('T')[0])

      if (error) {
        console.error('Failed to opt out reminders for', from, error)
      } else {
        console.log(`Opted out future reminders for ${from}`)
      }

      return new NextResponse(
        generateSMSResponse(
          "You've been opted out of appointment reminders. Reply START to opt back in."
        ),
        { headers: { 'Content-Type': 'text/xml' } }
      )
    }

    // Handle START — opt back in to reminders
    if (/\bSTART\b/i.test(body.trim())) {
      const { error } = await supabaseAdmin
        .from('appointments')
        .update({ reminder_opted_out: false })
        .eq('patient_phone', from)
        .gt('appointment_date', new Date().toISOString().split('T')[0])

      if (error) {
        console.error('Failed to opt in reminders for', from, error)
      } else {
        console.log(`Opted back in to reminders for ${from}`)
      }

      return new NextResponse(
        generateSMSResponse("You've been opted back in to appointment reminders."),
        { headers: { 'Content-Type': 'text/xml' } }
      )
    }

    // All other inbound messages — no action, return empty TwiML
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { 'Content-Type': 'text/xml' } }
    )
  } catch (error) {
    console.error('SMS webhook error:', error)
    // Always return valid TwiML so Twilio doesn't retry
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { 'Content-Type': 'text/xml' } }
    )
  }
}
