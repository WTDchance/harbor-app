import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { sendSMS } from '@/lib/twilio'

const DEFAULT_PREP_TEMPLATE = "Hi {patient_name}, this is a reminder that you have an appointment with {provider_name} tomorrow at {time}. Is there anything specific you'd like to focus on in your session? (You don't need to reply — just wanted you to feel prepared.)"

function buildPrepMessage(
  template: string,
  vars: { patient_name: string; provider_name: string; time: string; practice_name: string }
): string {
  return template
    .replace(/{patient_name}/g, vars.patient_name)
    .replace(/{provider_name}/g, vars.provider_name)
    .replace(/{time}/g, vars.time)
    .replace(/{practice_name}/g, vars.practice_name)
}

function getTomorrowWindow(): { start: string; end: string } {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)
  const tomorrowEnd = new Date(tomorrow)
  tomorrowEnd.setHours(23, 59, 59, 999)
  return {
    start: tomorrow.toISOString(),
    end: tomorrowEnd.toISOString()
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: practice } = await supabase
      .from('practices')
      .select('id, name, provider_name, prep_message_enabled, prep_message_template')
      .eq('auth_user_id', user.id)
      .single()

    if (!practice) {
      return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
    }

    if (practice.prep_message_enabled === false) {
      return NextResponse.json({ sent: 0, total: 0, message: 'Prep messages disabled for this practice' })
    }

    const template = practice.prep_message_template || DEFAULT_PREP_TEMPLATE
    const { start, end } = getTomorrowWindow()

    const { data: appointments } = await supabase
      .from('appointments')
      .select('id, patient_name, patient_phone, start_time, prep_message_sent')
      .eq('practice_id', practice.id)
      .eq('status', 'confirmed')
      .gte('start_time', start)
      .lte('start_time', end)
      .not('patient_phone', 'is', null)

    if (!appointments || appointments.length === 0) {
      return NextResponse.json({ sent: 0, total: 0, message: 'No confirmed appointments tomorrow' })
    }

    const pending = appointments.filter(a => !a.prep_message_sent)
    let sentCount = 0
    const results: Array<{ id: string; patient_name: string; status: string; error?: string }> = []

    for (const appt of pending) {
      try {
        const apptTime = new Date(appt.start_time)
        const timeStr = apptTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

        const message = buildPrepMessage(template, {
          patient_name: appt.patient_name || 'there',
          provider_name: practice.provider_name || practice.name,
          time: timeStr,
          practice_name: practice.name
        })

        await sendSMS(appt.patient_phone, message)

        await supabase
          .from('appointments')
          .update({
            prep_message_sent: true,
            prep_message_sent_at: new Date().toISOString()
          })
          .eq('id', appt.id)

        sentCount++
        results.push({ id: appt.id, patient_name: appt.patient_name || 'Unknown', status: 'sent' })
      } catch (err) {
        console.error(`Failed to send prep message for appointment ${appt.id}:`, err)
        results.push({ id: appt.id, patient_name: appt.patient_name || 'Unknown', status: 'failed', error: String(err) })
      }
    }

    return NextResponse.json({
      sent: sentCount,
      total: pending.length,
      skipped: appointments.length - pending.length,
      results
    })

  } catch (error) {
    console.error('Prep messages error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: practice } = await supabase
      .from('practices')
      .select('id, name, provider_name, prep_message_enabled, prep_message_template')
      .eq('auth_user_id', user.id)
      .single()

    if (!practice) {
      return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
    }

    const { start, end } = getTomorrowWindow()

    const { data: appointments } = await supabase
      .from('appointments')
      .select('id, patient_name, patient_phone, start_time, prep_message_sent, prep_message_sent_at')
      .eq('practice_id', practice.id)
      .eq('status', 'confirmed')
      .gte('start_time', start)
      .lte('start_time', end)
      .not('patient_phone', 'is', null)

    const pending = (appointments || []).filter(a => !a.prep_message_sent)
    const sent = (appointments || []).filter(a => a.prep_message_sent)

    return NextResponse.json({
      tomorrow_appointments: (appointments || []).length,
      pending_messages: pending.length,
      already_sent: sent.length,
      prep_message_enabled: practice.prep_message_enabled !== false,
      appointments: appointments || []
    })

  } catch (error) {
    console.error('Prep messages GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
