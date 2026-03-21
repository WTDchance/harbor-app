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

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const practice_id = searchParams.get('practice_id')

    if (!practice_id) {
      return NextResponse.json(
        { error: 'Missing practice_id parameter' },
        { status: 400 }
      )
    }

    // Fetch reminders for practice, ordered by creation date
    const { data: reminders, error } = await supabaseAdmin
      .from('appointment_reminders')
      .select('*')
      .eq('practice_id', practice_id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('Error fetching reminders:', error)
      return NextResponse.json(
        { error: 'Failed to fetch reminders' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      reminders: reminders || [],
    })
  } catch (error) {
    console.error('Error in GET /api/reminders:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
