// Vapi.ai webhook handler
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateCallSummary } from '@/lib/claude'
import { getCallSummaryPrompt } from '@/lib/ai-prompts'
import { sendEmail, buildCallSummaryEmail } from '@/lib/email'
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
    // Auth check
    const secret = request.nextUrl.searchParams.get('secret')
    if (process.env.VAPI_WEBHOOK_SECRET && secret !== process.env.VAPI_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Vapi wraps the payload in a "message" object — unwrap it
    const body = await request.json()
    const message = body.message || body
    const type = message.type
    const call = message.call

    console.log('Vapi webhook received, type:', type, '| call id:', call?.id)

    if (type === 'call-started') {
      console.log('Call started:', call?.id)
      return NextResponse.json({ received: true })
    }

    // Vapi fires "end-of-call-report" (not "call-ended") for real phone calls
    if (type === 'end-of-call-report' || type === 'call-ended') {
      const callId = call?.id

      // Transcript can be on message OR call object depending on Vapi version
      const transcript = message.transcript || call?.transcript || ''

      // Duration: prefer message.durationSeconds, fall back to calculating from timestamps
      const duration =
        message.durationSeconds ||
        (call?.endedAt && call?.startedAt
          ? Math.round(
              (new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000
            )
          : 0)

      const lowerTranscript = transcript.toLowerCase()
      const crisisDetected = CRISIS_KEYWORDS.some((kw) => lowerTranscript.includes(kw))
      const patientPhone = call?.customer?.number || 'unknown'

      // Resolve practiceId: prefer metadata, then look up by called phone number
      let practiceId: string | null = call?.metadata?.practiceId || null

      if (!practiceId) {
        // Vapi can put the called number in multiple places
        const calledNumber =
          call?.phoneNumber?.number ||
          message?.phoneNumber?.number ||
          call?.phoneNumber?.twilioPhoneNumber ||
          null

        console.log('Looking up practice by phone number:', calledNumber)

        if (calledNumber) {
          // Try exact match first
          const { data: exactMatch } = await supabaseAdmin
            .from('practices')
            .select('id')
            .eq('phone_number', calledNumber)
            .single()

          if (exactMatch) {
            practiceId = exactMatch.id
            console.log('Resolved practiceId via exact phone match:', practiceId)
          } else {
            // Try normalized last-10-digits match
            const digits = calledNumber.replace(/\D/g, '').slice(-10)
            const { data: allPractices } = await supabaseAdmin
              .from('practices')
              .select('id, phone_number')

            if (allPractices) {
              const match = allPractices.find(
                (p) => p.phone_number?.replace(/\D/g, '').slice(-10) === digits
              )
              if (match) {
                practiceId = match.id
                console.log('Resolved practiceId via normalized phone match:', practiceId)
              }
            }
          }
        }
      }

      if (!practiceId) {
        console.warn(
          'Could not resolve practiceId — skipping DB save.',
          'Call ID:', callId,
          'Payload preview:', JSON.stringify(body).substring(0, 600)
        )
        return NextResponse.json({ received: true, callId })
      }

      // Fetch practice details (includes notification_emails if column exists)
      const { data: practice } = await supabaseAdmin
        .from('practices')
        .select('*')
        .eq('id', practiceId)
        .single()

      // Get primary contact email from users table
      const { data: userRecord } = await supabaseAdmin
        .from('users')
        .select('email')
        .eq('practice_id', practiceId)
        .single()

      const primaryEmail = userRecord?.email || null
      const notificationEmails: string[] = (practice as any)?.notification_emails || []

      // All unique recipients
      const allEmails = [...new Set([
        ...(primaryEmail ? [primaryEmail] : []),
        ...notificationEmails,
      ])]

      // Generate AI summary (use Vapi's summary if provided, else generate)
      let aiSummary = message.summary || ''
      if (!aiSummary && transcript) {
        try {
          const prompt = getCallSummaryPrompt(transcript)
          aiSummary = await generateCallSummary(prompt)
        } catch (err) {
          console.error('Failed to generate call summary:', err)
          aiSummary = 'Summary unavailable.'
        }
      }

      // Save to call_logs
      const { error: dbError } = await supabaseAdmin.from('call_logs').insert({
        vapi_call_id: callId,
        practice_id: practiceId,
        patient_phone: patientPhone,
        transcript,
        summary: aiSummary,
        duration_seconds: duration,
      })

      if (dbError) console.error('Failed to save call record:', dbError)

      // Send summary email to all recipients
      if (allEmails.length > 0) {
        try {
          const emailHtml = buildCallSummaryEmail({
            practiceName: practice?.name || 'Your Practice',
            callerNumber: patientPhone,
            duration,
            summary: aiSummary,
            crisisDetected,
            transcript,
          })

          for (const email of allEmails) {
            await sendEmail({
              to: email,
              subject: crisisDetected
                ? 'CRISIS ALERT - Call Summary from Harbor'
                : 'Call Summary from Harbor',
              html: emailHtml,
            }).catch((err) => console.error('Failed to send email to', email, err))
          }
        } catch (emailErr) {
          console.error('Failed to send summary emails:', emailErr)
        }
      }

      // Crisis SMS alert
      if (crisisDetected && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
        try {
          const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
          const alertNumber = (practice as any)?.crisis_alert_phone
          if (alertNumber && alertNumber.startsWith('+')) {
            await twilioClient.messages.create({
              body:
                'CRISIS ALERT: A caller may be in distress. Please review the call recording immediately. Call ID: ' +
                callId,
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
      const functionName = message.functionCall?.name
      const parameters = message.functionCall?.parameters || {}

      if (functionName === 'checkAvailability') {
        return NextResponse.json({
          result:
            'I can check availability for you. Our next available appointments are typically within the next 1-2 weeks. Would you like me to have someone from the practice follow up with you directly to schedule?',
        })
      }

      if (functionName === 'collectIntakeInfo') {
        const practiceId = call?.metadata?.practiceId
        if (practiceId && parameters) {
          await supabaseAdmin
            .from('intake_submissions')
            .insert({
              practice_id: practiceId,
              vapi_call_id: call?.id,
              caller_number: call?.customer?.number || null,
              intake_data: parameters,
            })
            .catch((err: unknown) => console.error('Failed to save intake data:', err))
        }
        return NextResponse.json({
          result:
            'Thank you for sharing that information. Someone from our team will follow up with you soon.',
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
