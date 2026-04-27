import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendSMS } from '@/lib/aws/signalwire'

function formatTime(time: string) {
  const [h, m] = time.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
}

function formatDate(d: string) {
  return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

// Wave 41: legacy `/api/reminders/send/send/` nested-shim. Wave-32 cron used
// to hit this path with raw Twilio fetch. Now routes through
// lib/aws/signalwire::sendSMS so the HIPAA stack stays SignalWire/Retell only.
//
// SMS_ENABLED env gate retained for the original "A2P 10DLC pending" path.
// The reminder_logs row keeps its twilio_sid column for backwards-compat with
// dashboards that already query it; the value is now the SignalWire message
// SID. (Audit note: column rename is a separate DB migration.)
async function sendReminderSMS(to: string, body: string, practiceId: string | null) {
  if (process.env.SMS_ENABLED !== 'true') {
    console.log(`[SMS DISABLED] Would have sent to ${to}: ${body}`)
    return { sid: null, status: 'disabled' }
  }
  const r = await sendSMS({ to, body, practiceId })
  if (r.ok) return { sid: r.sid, status: 'sent' }
  return { sid: null, status: r.reason }
}

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get('x-cron-secret')
    if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]

    const { data: appointments } = await supabaseAdmin
      .from('appointments')
      .select('*, practices(name, reminder_message_template)')
      .eq('appointment_date', tomorrowStr)
      .eq('reminder_sent', false)
      .in('status', ['scheduled', 'confirmed'])

    if (!appointments?.length) return NextResponse.json({ message: 'No reminders to send', count: 0 })

    const results = []

    for (const appt of appointments) {
      try {
        const practice = appt.practices as any
        let msg = practice?.reminder_message_template ||
          'Hi {name}! Reminder: appointment with {provider} tomorrow, {date} at {time}. Reply CONFIRM or CANCEL.'
        msg = msg
          .replace('{name}', appt.patient_name.split(' ')[0])
          .replace('{provider}', practice?.name || 'your therapist')
          .replace('{date}', formatDate(appt.appointment_date))
          .replace('{time}', formatTime(appt.appointment_time))

        const result = await sendReminderSMS(appt.patient_phone, msg, appt.practice_id ?? null)

        await supabaseAdmin.from('appointments').update({
          reminder_sent: true,
          reminder_sent_at: new Date().toISOString(),
        }).eq('id', appt.id)

        await supabaseAdmin.from('reminder_logs').insert({
          practice_id: appt.practice_id,
          appointment_id: appt.id,
          message_sent: msg,
          twilio_sid: result.sid,
          status: result.status === 'sent' ? 'sent' : 'failed',
        })

        results.push({ patient: appt.patient_name, status: result.status })
      } catch (err: any) {
        results.push({ patient: appt.patient_name, status: 'failed', error: err.message })
      }
    }

    return NextResponse.json({ count: results.length, results })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Reminder system active. POST to trigger.' })
}
