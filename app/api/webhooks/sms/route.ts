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
          const to = p.get('To') || ''
          const messageBody = p.get('Body') || ''
          const messageSid = p.get('MessageSid') || ''
          const reply = messageBody.trim().toUpperCase()

          // Find practice by matching TWILIO_PHONE_NUMBER or looking up by To field
          const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER
          let practice = null

          if (twilioPhoneNumber && to === twilioPhoneNumber) {
            const { data } = await supabaseAdmin
              .from('practices')
              .select('id, name, phone_number')
              .eq('phone_number', twilioPhoneNumber)
              .single()
            practice = data
          } else {
            const { data } = await supabaseAdmin
              .from('practices')
              .select('id, name, phone_number')
              .eq('phone_number', to)
              .single()
            practice = data
          }

          // Upsert SMS conversation record
          if (practice) {
            const { data: existingConversation } = await supabaseAdmin
              .from('sms_conversations')
              .select('id, messages_json')
              .eq('practice_id', practice.id)
              .eq('patient_phone', from)
              .single()

            const newMessage = {
              direction: 'inbound' as const,
              content: messageBody,
              timestamp: new Date().toISOString(),
              message_sid: messageSid,
            }

            if (existingConversation) {
              const updatedMessages = [...existingConversation.messages_json, newMessage]
              await supabaseAdmin
                .from('sms_conversations')
                .update({
                  messages_json: updatedMessages,
                  last_message_at: new Date().toISOString(),
                })
                .eq('id', existingConversation.id)
            } else {
              await supabaseAdmin
                .from('sms_conversations')
                .insert({
                  practice_id: practice.id,
                  patient_phone: from,
                  messages_json: [newMessage],
                  last_message_at: new Date().toISOString(),
                })
            }
          }

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
                  if (practice) {
                    const { data: existingConversation } = await supabaseAdmin
                      .from('sms_conversations')
                      .select('id, messages_json')
                      .eq('practice_id', practice.id)
                      .eq('patient_phone', from)
                      .single()
                    const responseMessage = {
                      direction: 'outbound' as const,
                      content: "Thanks for your message! We couldn't find an upcoming appointment for your number. Please call us directly.",
                      timestamp: new Date().toISOString(),
                    }
                    if (existingConversation) {
                      const updatedMessages = [...existingConversation.messages_json, responseMessage]
                      await supabaseAdmin
                        .from('sms_conversations')
                        .update({
                          messages_json: updatedMessages,
                          last_message_at: new Date().toISOString(),
                        })
                        .eq('id', existingConversation.id)
                    }
                  }
                  return xmlResponse
                }

          const appt = appts[0]
          const practiceFromAppt = appt.practices as any

          if (['CONFIRM', 'C', 'YES', 'Y', '1'].some(k => reply.startsWith(k))) {
                  await supabaseAdmin.from('appointments').update({
                            status: 'confirmed',
                            confirmation_reply: 'CONFIRM',
                            confirmation_reply_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                          }).eq('id', appt.id)

                  const confirmMessage = `✓ Confirmed! See you ${fmtDate(appt.appointment_date)} at ${fmtTime(appt.appointment_time)} with ${practiceFromAppt?.name || 'your therapist'}. Reply CANCEL if plans change.`
                  await sendSMS(from, confirmMessage)

                  if (practice) {
                    const { data: existingConversation } = await supabaseAdmin
                      .from('sms_conversations')
                      .select('id, messages_json')
                      .eq('practice_id', practice.id)
                      .eq('patient_phone', from)
                      .single()
                    const responseMessage = {
                      direction: 'outbound' as const,
                      content: confirmMessage,
                      timestamp: new Date().toISOString(),
                    }
                    if (existingConversation) {
                      const updatedMessages = [...existingConversation.messages_json, responseMessage]
                      await supabaseAdmin
                        .from('sms_conversations')
                        .update({
                          messages_json: updatedMessages,
                          last_message_at: new Date().toISOString(),
                        })
                        .eq('id', existingConversation.id)
                    }
                  }

                } else if (['CANCEL', 'X', 'NO', 'N', '2'].some(k => reply.startsWith(k))) {
                  await supabaseAdmin.from('appointments').update({
                            status: 'cancelled',
                            confirmation_reply: 'CANCEL',
                            confirmation_reply_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                          }).eq('id', appt.id)

                  const cancelMessage = `Your appointment has been cancelled. Please call us to reschedule when you're ready.`
                  await sendSMS(from, cancelMessage)

                  if (practice) {
                    const { data: existingConversation } = await supabaseAdmin
                      .from('sms_conversations')
                      .select('id, messages_json')
                      .eq('practice_id', practice.id)
                      .eq('patient_phone', from)
                      .single()
                    const responseMessage = {
                      direction: 'outbound' as const,
                      content: cancelMessage,
                      timestamp: new Date().toISOString(),
                    }
                    if (existingConversation) {
                      const updatedMessages = [...existingConversation.messages_json, responseMessage]
                      await supabaseAdmin
                        .from('sms_conversations')
                        .update({
                          messages_json: updatedMessages,
                          last_message_at: new Date().toISOString(),
                        })
                        .eq('id', existingConversation.id)
                    }
                  }

                  const { data: waitlist } = await supabaseAdmin
                    .from('waitlist')
                    .select('*')
                    .eq('practice_id', practiceFromAppt.id)
                    .eq('status', 'waiting')
                    .order('created_at')
                    .limit(1)

                  if (waitlist?.[0]?.patient_phone) {
                            const w = waitlist[0]
                            await sendSMS(w.patient_phone,
                                                    `Hi ${w.patient_name.split(' ')[0]}! A slot just opened: ${fmtDate(appt.appointment_date)} at ${fmtTime(appt.appointment_time)} with ${practiceFromAppt?.name}. Call us to book!`
                                                  )
                            await supabaseAdmin.from('waitlist').update({ status: 'notified' }).eq('id', w.id)
                          }
                } else {
                  const helpMessage = `Reply CONFIRM to confirm your appointment or CANCEL to cancel. Need help? Please call us directly.`
                  await sendSMS(from, helpMessage)

                  if (practice) {
                    const { data: existingConversation } = await supabaseAdmin
                      .from('sms_conversations')
                      .select('id, messages_json')
                      .eq('practice_id', practice.id)
                      .eq('patient_phone', from)
                      .single()
                    const responseMessage = {
                      direction: 'outbound' as const,
                      content: helpMessage,
                      timestamp: new Date().toISOString(),
                    }
                    if (existingConversation) {
                      const updatedMessages = [...existingConversation.messages_json, responseMessage]
                      await supabaseAdmin
                        .from('sms_conversations')
                        .update({
                          messages_json: updatedMessages,
                          last_message_at: new Date().toISOString(),
                        })
                        .eq('id', existingConversation.id)
                    }
                  }
                }

          return xmlResponse
        } catch (e: any) {
          console.error('SMS webhook error:', e)
          return new NextResponse('<?xml version="1.0"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
        }
                                               }
