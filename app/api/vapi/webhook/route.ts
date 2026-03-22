// Vapi.ai webhook handler
// Receives events from Vapi for incoming calls
// Events: call-started, transcript, call-ended, function-call

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateCallSummary } from '@/lib/claude'
import { getCallSummaryPrompt } from '@/lib/ai-prompts'
import { sendEmail, buildCallSummaryEmail } from '@/lib/email'
import type { VapiWebhookPayload } from '@/types'
import twilio from 'twilio'

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER

const CRISIS_KEYWORDS = [
    'suicide', 'kill myself', 'end my life', 'hurt myself', 'self-harm',
    "don't want to be here", 'overdose', 'crisis', 'not worth living',
  ]

export async function POST(request: NextRequest) {
    try {
          const secret = request.nextUrl.searchParams.get('secret')
          if (process.env.VAPI_WEBHOOK_SECRET && secret !== process.env.VAPI_WEBHOOK_SECRET) {
                  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
          }
          const payload: VapiWebhookPayload = await request.json()
          const { type, call } = payload

      if (type === 'call-started') {
              console.log('Call started:', call?.id)
              return NextResponse.json({ received: true })
      }

      if (type === 'call-ended') {
              const callId = call?.id
              const transcript = call?.transcript || ''
              const duration = call?.endedAt && call?.startedAt
                ? Math.round((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000)
                        : 0
              const lowerTranscript = transcript.toLowerCase()
              const crisisDetected = CRISIS_KEYWORDS.some(kw => lowerTranscript.includes(kw))
              const patientPhone = call?.customer?.number || 'unknown'

            // Resolve practiceId: prefer metadata, fall back to looking up by the called phone number
            let practiceId: string | null = call?.metadata?.practiceId || null

            if (!practiceId) {
                      const calledNumber = call?.phoneNumber?.number
                      if (calledNumber) {
                                  const { data: practiceByPhone } = await supabaseAdmin
                                    .from('practices')
                                    .select('id')
                                    .eq('phone_number', calledNumber)
                                    .single()
                                  if (practiceByPhone) {
                                                practiceId = practiceByPhone.id
                                                console.log('Resolved practiceId via phone number lookup:', practiceId)
                                  }
                      }
            }

            if (!practiceId) {
                      console.warn('Could not resolve practiceId — skipping DB save. Call ID:', callId)
                      return NextResponse.json({ received: true, callId })
            }

            // Fetch practice details
            const { data: practice } = await supabaseAdmin
                .from('practices')
                .select('*')
                .eq('id', practiceId)
                .single()

            // Get therapist email from users table
            const { data: userRecord } = await supabaseAdmin
                .from('users')
                .select('email')
                .eq('practice_id', practiceId)
                .single()
              const therapistEmail = userRecord?.email || null

            let summary = ''
              try {
                        const prompt = getCallSummaryPrompt(transcript)
                        summary = await generateCallSummary(prompt)
              } catch (err) {
                        console.error('Failed to generate call summary:', err)
                        summary = 'Summary unavailable.'
              }

            // Save to call_logs
            const { error: dbError } = await supabaseAdmin
                .from('call_logs')
                .insert({
                            vapi_call_id: callId,
                            practice_id: practiceId,
                            patient_phone: patientPhone,
                            transcript,
                            summary,
                            duration_seconds: duration,
                })
              if (dbError) console.error('Failed to save call record:', dbError)

            if (therapistEmail) {
                      try {
                                  const emailHtml = buildCallSummaryEmail({
                                                practiceName: practice?.name || 'Your Practice',
                                                callerNumber: patientPhone,
                                                duration, summary, crisisDetected, transcript,
                                  })
                                  await sendEmail({
                                                to: therapistEmail,
                                                subject: crisisDetected
                                                  ? 'CRISIS ALERT - Call Summary from Harbor'
                                                                : 'Call Summary from Harbor',
                                                html: emailHtml,
                                  })
                      } catch (emailErr) { console.error('Failed to send summary email:', emailErr) }
            }

            if (crisisDetected && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
                      try {
                                  const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
                                  const alertNumber = (practice as any)?.crisis_alert_phone
                                  if (alertNumber && alertNumber.startsWith('+')) {
                                                await twilioClient.messages.create({
                                                                body: 'CRISIS ALERT: A caller may be in distress. Please review the call recording immediately. Call ID: ' + callId,
                                                                from: TWILIO_PHONE_NUMBER, to: alertNumber,
                                                })
                                  }
                      } catch (smsErr) { console.error('Failed to send crisis SMS:', smsErr) }
            }

            return NextResponse.json({ received: true, callId, crisisDetected })
      }

      if (type === 'function-call') {
              const functionName = payload.functionCall?.name
              const parameters = payload.functionCall?.parameters || {}
                      if (functionName === 'checkAvailability') {
                                return NextResponse.json({ result: 'I can check availability for you. Our next available appointments are typically within the next 1-2 weeks. Would you like me to have someone from the practice follow up with you directly to schedule?' })
                      }
              if (functionName === 'collectIntakeInfo') {
                        const practiceId = call?.metadata?.practiceId
                        if (practiceId && parameters) {
                                    await supabaseAdmin.from('intake_submissions').insert({
                                                  practice_id: practiceId, vapi_call_id: call?.id,
                                                  caller_number: call?.customer?.number || null, intake_data: parameters,
                                    }).catch((err: unknown) => console.error('Failed to save intake data:', err))
                        }
                        return NextResponse.json({ result: 'Thank you for sharing that information. Someone from our team will follow up with you soon.' })
              }
              return NextResponse.json({ result: 'Function handled.' })
      }

      return NextResponse.json({ received: true })
    } catch (error) {
          console.error('Webhook error:', error)
          return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
