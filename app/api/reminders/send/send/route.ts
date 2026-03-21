import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

function formatTime(time: string) {
  const [h, m] = time.split(':')
    const hour = parseInt(h)
      return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
      }

      function formatDate(d: string) {
        return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
        }

        async function sendSMS(to: string, body: string) {
          const sid = process.env.TWILIO_ACCOUNT_SID!
            const token = process.env.TWILIO_AUTH_TOKEN!
              const from = process.env.TWILIO_PHONE_NUMBER!
                const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
                    method: 'POST',
                        headers: {
                              Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
                                    'Content-Type': 'application/x-www-form-urlencoded',
                                        },
                                            body: new URLSearchParams({ Body: body, From: from, To: to }),
                                              })
                                                return res.json()
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
                                                                                                                                                                                                              
                                                                                                                                                                                                                      const twilioData = await sendSMS(appt.patient_phone, msg)
                                                                                                                                                                                                                      
                                                                                                                                                                                                                              await supabaseAdmin.from('appointments').update({
                                                                                                                                                                                                                                        reminder_sent: true,
                                                                                                                                                                                                                                                  reminder_sent_at: new Date().toISOString(),
                                                                                                                                                                                                                                                          }).eq('id', appt.id)
                                                                                                                                                                                                                                                          
                                                                                                                                                                                                                                                                  await supabaseAdmin.from('reminder_logs').insert({
                                                                                                                                                                                                                                                                            practice_id: appt.practice_id,
                                                                                                                                                                                                                                                                                      appointment_id: appt.id,
                                                                                                                                                                                                                                                                                                message_sent: msg,
                                                                                                                                                                                                                                                                                                          twilio_sid: twilioData.sid,
                                                                                                                                                                                                                                                                                                                    status: 'sent',
                                                                                                                                                                                                                                                                                                                            })
                                                                                                                                                                                                                                                                                                                            
                                                                                                                                                                                                                                                                                                                                    results.push({ patient: appt.patient_name, status: 'sent' })
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
