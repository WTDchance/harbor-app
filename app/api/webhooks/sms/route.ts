import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

async function sendSMS(to: string, body: string) {
    const sid = process.env.TWILIO_ACCOUNT_SID!
    const token = process.env.TWILIO_AUTH_TOKEN!
    const from = process.env.TWILIO_PHONE_NUMBER!
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: 'POST',
          headers: {
                  Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
          body: new URLSearchParams({ Body: body, From: from, To: to }),
        })
  }

function fmtTime(t: string) {
    const [h, m] = t.split(':')
    const hour = parseInt(h)
    return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
  }

function fmtDate(d: string) {
    return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  }

export async function POST(req: NextRequest) {
    try {
          const body = await req.text()
          const p = new URLSearchParams(body)
          const from = p.get('From') || ''
          const reply = (p.get('Body') || '').trim().toUpperCase()

          const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
          const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7)

          const { data: appts } = await supabaseAdmin
            .from('appointments')
            .select('*, practices(id, name)')
            .eq('patient_phone', from)
            .gte('appointment_date', tomorrow.toISOString().split('T')[0])
            .lte('appointment_date', nextWeek.toISOString().split('T')[0])
            .in('status', ['scheduled', 'confirmed'])
            .order('appointment_date')
            .limit(1)

          const xmlResponse = new NextResponse('<?xml version="1.0"?><Response></Response>', {
                  headers: { 'Content-Type': 'text/xml' },
                })

          if (!appts?.length) {
                  await sendSMS(from, "Thanks for your message! We couldn't find an upcoming appointment for your number. Please call us directly.")
                  return xmlResponse
                }

          const appt = appts[0]
          const practice = appt.practices as any

          if (['CONFIRM', 'C', 'YES', 'Y', '1'].some(k => reply.startsWith(k))) {
                  await supabaseAdmin.from('appointments').update({
                            status: 'confirmed',
                            confirmation_reply: 'CONFIRM',
                            confirmation_reply_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                          }).eq('id', appt.id)

                  await sendSMS(from, `✓ Confirmed! See you ${fmtDate(appt.appointment_date)} at ${fmtTime(appt.appointment_time)} with ${practice?.name || 'your therapist'}. Reply CANCEL if plans change.`)

                } else if (['CANCEL', 'X', 'NO', 'N', '2'].some(k => reply.startsWith(k))) {
                  await supabaseAdmin.from('appointments').update({
                            status: 'cancelled',
                            confirmation_reply: 'CANCEL',
                            confirmation_reply_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                          }).eq('id', appt.id)

                  await sendSMS(from, `Your appointment has been cancelled. Please call us to reschedule when you\'re ready.`)

                  const { data: waitlist } = await supabaseAdmin
                    .from('waitlist')
                    .select('*')
                    .eq('practice_id', practice.id)
                    .eq('status', 'waiting')
                    .order('created_at')
                    .limit(1)

                  if (waitlist?.[0]?.patient_phone) {
                            const w = waitlist[0]
                            await sendSMS(w.patient_phone,
                                                    `Hi ${w.patient_name.split(' ')[0]}! A slot just opened: ${fmtDate(appt.appointment_date)} at ${fmtTime(appt.appointment_time)} with ${practice?.name}. Call us to book!`
                                                  )
                            await supabaseAdmin.from('waitlist').update({ status: 'notified' }).eq('id', w.id)
                          }
                } else {
                  await sendSMS(from, `Reply CONFIRM to confirm your appointment or CANCEL to cancel. Need help? Please call us directly.`)
                }

          return xmlResponse
        } catch (e: any) {
          console.error('SMS webhook error:', e)
          return new NextResponse('<?xml version="1.0"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
        }
  }
