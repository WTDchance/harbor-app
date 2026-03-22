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

// Crisis keywords to detect in transcripts
const CRISIS_KEYWORDS = [
  'suicide',
  'kill myself',
  'end my life',
  'hurt myself',
  'self-harm',
  "don't want to be here",
  'overdose',
  'crisis',
  'not worth living',
]

/**
 * POST /api/vapi/webhook
 * Handles incoming Vapi webhook events
 */
export async function POST(request: NextRequest) {
  try {
    // Validate webhook secret
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

      const practiceId = call?.metadata?.practiceId
      let practice = null
      let therapistEmail = null

      if (practiceId) {
        const { data: practiceData } = await supabaseAdmin
          .from('practices')
          .select('*, profiles(email)')
          .eq('id', practiceId)
          .single()
        practice = practiceData
        therapistEmail = practiceData?.profiles?.email
      }

      let summary = ''
      try {
        const prompt = getCallSummaryPrompt(transcript)
        summary = await generateCallSummary(prompt)
      } catch (err) {
        console.error('Failed to generate call summary:', err)
        summary = 'Summary unavailable.'
      }

      const { data: callRecord, error: dbError } = await supabaseAdmin
        .from('calls')
        .insert({
          vapi_call_id: callId,
          practice_id: practiceId || null,
          transcript,
          summary,
          duration_seconds: duration,
          crisis_detected: crisisDetected,
          caller_number: call?.customer?.number || null,
          started_at: call?.startedAt || null,
          ended_at: call?.endedAt || null,
        })
        .select()
        .single()

      if (dbError) {
        console.error('Failed to save call record:', dbError)
      }

      if (therapistEmail && callRecord) {
        try {
          const emailHtml = buildCallSummaryEmail({
            practiceName: practice?.name || 'Your Practice',
            callerNumber: call?.customer?.number || 'Unknown',
            duration,
            summary,
            crisisDetected,
            transcript,
          })
          await sendEmail({
            to: therapistEmail,
            subject: crisisDetected
              ? 'CRISIS ALERT - Call Summary from Harbor'
              : 'Call Summary from Harbor',
            html: emailHtml,
          })
        } catch (emailErr) {
          console.error('Failed to send summary email:', emailErr)
        }
      }

      if (crisisDetected && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
        try {
          const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
          const alertNumber = practice?.crisis_alert_phone
          if (alertNumber && alertNumber.startsWith('+')) {
            await twilioClient.messages.create({
              body: 'CRISIS ALERT: A caller may be in distress. Please review the call recording immediately. Call ID: ' + callId,
              from: TWILIO_PHONE_NUMBER,
              to: alertNumber,
            })
          }
        } catch (smsErr) {
          console.error('Failed to send crisis SMS:', smsErr)
        }
      }

      return NextResponse.json({ received: true, callId, crisisDetected })
    }

    if (type === 'function-call') {
      const functionName = payload.functionCall?.name
      const parameters = payload.functionCall?.parameters || {}

      if (functionName === 'checkAvailability') {
        return NextResponse.json({
          result: 'I can check availability for you. Our next available appointments are typically within the next 1-2 weeks. Would you like me to have someone from the practice follow up with you directly to schedule?'
        })
      }

      if (functionName === 'collectIntakeInfo') {
        const practiceId = call?.metadata?.practiceId
        if (practiceId && parameters) {
          await supabaseAdmin.from('intake_responses').insert({
            practice_id: practiceId,
            vapi_call_id: call?.id,
            caller_number: call?.customer?.number || null,
            intake_data: parameters,
          }).catch((err: unknown) => console.error('Failed to save intake data:', err))
        }
        return NextResponse.json({
          result: 'Thank you for sharing that information. Someone from our team will follow up with you soon.'
        })
      }

      return NextResponse.json({ result: 'Function handled.' })
    }

    return NextResponse.json({ received: true })

  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
                  }
