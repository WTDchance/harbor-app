import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

async function getPractice() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: (s) => { try { s.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} } } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('practices').select('id, name').eq('notification_email', user.email).single()
  return data
}

export async function POST(request: NextRequest) {
  try {
    const practice = await getPractice()
    if (!practice) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { practice_id, patient_phone, patient_name, appointment_time, session_type } = await request.json()

    if (practice_id !== practice.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: practiceData } = await supabaseAdmin
      .from('practices')
      .select('name')
      .eq('id', practice_id)
      .single()

    const timeFormatted = new Date(appointment_time).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    })

    const message = `Harbor Receptionist: Hi ${patient_name}, reminder: you have a ${session_type || 'therapy'} appointment at ${practiceData?.name} on ${timeFormatted}. Reply CONFIRM or CANCEL. For in-person visits, reply HERE when you arrive and we'll notify your therapist! — Harbor`

    let twilio_sid = null
    if (process.env.TWILIO_ACCOUNT_SID && patient_phone) {
      const sid = process.env.TWILIO_ACCOUNT_SID
      const token = process.env.TWILIO_AUTH_TOKEN
      const from = process.env.TWILIO_PHONE_NUMBER!
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ Body: message, From: from, To: patient_phone }),
      })
      const msgData = await response.json()
      twilio_sid = msgData.sid
    }

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
    const practice = await getPractice()
    if (!practice) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const practice_id = request.nextUrl.searchParams.get('practice_id')

    if (!practice_id) {
      return NextResponse.json({ error: 'Missing practice_id parameter' }, { status: 400 })
    }

    if (practice_id !== practice.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: reminders, error } = await supabaseAdmin
      .from('appointment_reminders')
      .select('*')
      .eq('practice_id', practice_id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch reminders' }, { status: 500 })
    }

    return NextResponse.json({ reminders: reminders || [] })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
