import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import twilio from 'twilio'

export async function POST(request: NextRequest) {
  try {
    const { practice_id, patient_phone, patient_name, appointment_time, session_type } = await request.json()

    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('name')
      .eq('id', practice_id)
      .single()

    const timeFormatted = new Date(appointment_time).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    })

    const message = `Hi ${patient_name}, reminder: you have a ${session_type || 'therapy'} appointment at ${practice?.name} on ${timeFormatted}. Reply CONFIRM or CANCEL. — Harbor`

    let twilio_sid = null
    if (process.env.TWILIO_ACCOUNT_SID && patient_phone) {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
      const msg = await client.messages.create({
        to: patient_phone,
        from: process.env.TWILIO_PHONE_NUMBER!,
        body: message,
      })
      twilio_sid = msg.sid
    }

    // Log the reminder
    await supabaseAdmin.from('appointment_reminders').insert({
      practice_id,
      patient_phone,
      patient_name,
      appointment_time,
      session_type,
      twilio_sid,
    })

    return NextResponse.json({ success: true, twilio_sid })
  } catch (error) {
    console.error('Reminder error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
