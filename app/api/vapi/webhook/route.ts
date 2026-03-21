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
    const payload: VapiWebhookPayload = await request.json()
    const { type, callId, call, transcript, functionCall } = payload

    console.log(`📞 Vapi webhook: ${type}`, { callId })

    // Get practice ID from request header (set when configuring Vapi webhook URL)
    // e.g., webhook URL: /api/vapi/webhook?practice_id=<uuid>
    const practiceId = request.headers.get('x-practice-id') ||
      request.nextUrl.searchParams.get('practice_id') ||
      callId?.split('-')[0]

    if (!practiceId) {
      console.warn('⚠️ No practice_id in webhook')
      // Vapi still expects 200 response even if we can't process
      return NextResponse.json({ success: true })
    }

    switch (type) {
      case 'call-started':
        await handleCallStarted(callId, practiceId)
        break

      case 'transcript':
        await handleTranscript(callId, practiceId, transcript)
        break

      case 'call-ended':
        await handleCallEnded(callId, practiceId, call)
        break

      case 'function-call':
        await handleFunctionCall(callId, practiceId, functionCall)
        break
    }

    // Always return 200 to acknowledge receipt
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('❌ Vapi webhook error:', error)
    // Return 200 anyway - Vapi expects it
    return NextResponse.json({ error: 'Internal server error' }, { status: 200 })
  }
}

/**
 * Handle call-started event
 * This fires when a patient dials in and the AI receptionist answers
 */
async function handleCallStarted(callId: string, practiceId: string) {
  try {
    console.log(`✓ Call started: ${callId}`)
    // Can log to database or send notifications here if needed
  } catch (error) {
    console.error('Error in handleCallStarted:', error)
  }
}

/**
 * Handle transcript event
 * Vapi sends transcript pieces as the call progresses
 */
async function handleTranscript(
  callId: string,
  practiceId: string,
  transcript?: string
) {
  if (!transcript) return

  try {
    console.log(`📝 Transcript received: ${callId}`)
    // Could update real-time transcript in database here
  } catch (error) {
    console.error('Error in handleTranscript:', error)
  }
}

/**
 * Handle call-ended event
 * This fires after the call completes
 * We log the call and generate a summary
 */
async function handleCallEnded(
  callId: string,
  practiceId: string,
  call?: any
) {
  if (!call) {
    console.warn('No call data in call-ended event')
    return
  }

  try {
    const transcript = call.messages
      ?.map((msg: any) => `${msg.role === 'user' ? 'Caller' : 'Sam'}: ${msg.content}`)
      .join('\n') || ''

    const durationSeconds = call.durationSeconds || 0
    const phoneNumber = call.phoneNumber || 'Unknown'

    // Check for crisis keywords in transcript
    let crisisDetected = false
    const foundKeywords: string[] = []
    const lowerTranscript = transcript.toLowerCase()

    for (const keyword of CRISIS_KEYWORDS) {
      if (lowerTranscript.includes(keyword)) {
        crisisDetected = true
        foundKeywords.push(keyword)
      }
    }

    // Generate summary using Claude
    let summary = null
    if (transcript) {
      try {
        summary = await generateCallSummary(
          transcript,
          getCallSummaryPrompt()
        )
      } catch (error) {
        console.error('Error generating summary:', error)
        summary = 'Summary generation failed'
      }
    }

    // Log call to database using service role
    const { data: callLogData, error: callLogError } = await supabaseAdmin
      .from('call_logs')
      .insert({
        practice_id: practiceId,
        patient_phone: phoneNumber,
        duration_seconds: durationSeconds,
        transcript: transcript || null,
        summary: summary,
        vapi_call_id: callId,
        crisis_detected: crisisDetected,
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (callLogError) {
      console.error('Error inserting call log:', callLogError)
    } else {
      console.log(`✓ Call logged: ${callId}`)
    }

    // If crisis detected, insert crisis alert and send SMS
    if (crisisDetected && callLogData) {
      console.warn(`🚨 CRISIS DETECTED in call ${callId}`)

      // Insert crisis alert record
      const { error: crisisError } = await supabaseAdmin
        .from('crisis_alerts')
        .insert({
          practice_id: practiceId,
          call_log_id: callLogData.id,
          patient_phone: phoneNumber,
          keywords_found: foundKeywords,
        })

      if (crisisError) {
        console.error('Error inserting crisis alert:', crisisError)
      }

      // Send SMS alert to therapist if phone is configured
      try {
        const { data: practice } = await supabaseAdmin
          .from('practices')
          .select('name, therapist_phone')
          .eq('id', practiceId)
          .single()

        if (practice?.therapist_phone && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
          const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
          const message = `🚨 HARBOR CRISIS ALERT\nA caller to ${practice.name} may be in crisis.\nCaller: ${phoneNumber}\nPlease review immediately: https://harbor-app-production.up.railway.app/dashboard/calls\nIf unreachable, call 988 for guidance.`

          await twilioClient.messages.create({
            to: practice.therapist_phone,
            from: TWILIO_PHONE_NUMBER,
            body: message,
          })

          console.log(`✓ Crisis SMS sent to ${practice.therapist_phone}`)

          // Mark SMS as sent in crisis alert
          await supabaseAdmin
            .from('crisis_alerts')
            .update({ sms_sent: true })
            .eq('call_log_id', callLogData.id)
        }
      } catch (smsErr) {
        console.error('Error sending crisis SMS:', smsErr)
      }
    }

    // Send post-call email summary to the practice
    try {
      const { data: practice } = await supabaseAdmin
        .from('practices')
        .select('name, notification_email, ai_name, therapist_name')
        .eq('id', practiceId)
        .single()

      if (practice?.notification_email) {
        const callTime = new Date().toLocaleString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })

        let emailSubject = `${practice.name} — New Call from ${phoneNumber}`
        if (crisisDetected) {
          emailSubject = `🚨 ${emailSubject} (CRISIS FLAG)`
        }

        await sendEmail({
          to: practice.notification_email,
          subject: emailSubject,
          html: buildCallSummaryEmail({
            practiceName: practice.name,
            therapistName: practice.therapist_name || practice.ai_name || 'Ellie',
            callerPhone: phoneNumber,
            duration: durationSeconds,
            summary: summary || 'No summary available.',
            transcript,
            callTime,
            crisisDetected,
          }),
        })
        console.log(`✓ Post-call email sent to ${practice.notification_email}`)
      }
    } catch (emailErr) {
      console.error('Error sending post-call email:', emailErr)
    }
  } catch (error) {
    console.error('Error in handleCallEnded:', error)
  }
}

/**
 * Handle function-call event
 * Vapi can call functions during a call for things like:
 * - Submitting intake screening (PHQ-2, GAD-2)
 * - Booking appointments
 * - Getting practice information
 * - Updating patient records
 */
async function handleFunctionCall(
  callId: string,
  practiceId: string,
  functionCall?: any
) {
  if (!functionCall) return

  const { name, args } = functionCall

  try {
    console.log(`⚙️ Function call: ${name}`, args)

    // Handle intake screening submission
    if (name === 'submitIntakeScreening') {
      const { phq2_score, gad2_score, phq2_flag, gad2_flag, patient_phone } = args

      // Get the call log to link to this screening
      const { data: callLog } = await supabaseAdmin
        .from('call_logs')
        .select('id')
        .eq('vapi_call_id', callId)
        .single()

      const { error } = await supabaseAdmin
        .from('intake_screenings')
        .insert({
          practice_id: practiceId,
          call_log_id: callLog?.id || null,
          patient_phone: patient_phone || 'Unknown',
          phq2_score: phq2_score ?? 0,
          gad2_score: gad2_score ?? 0,
          phq2_flag: phq2_flag ?? false,
          gad2_flag: gad2_flag ?? false,
        })

      if (error) {
        console.error('Error submitting intake screening:', error)
      } else {
        console.log(`✓ Intake screening submitted for ${patient_phone}`)
      }
    }

    // Example: booking an appointment
    if (name === 'book_appointment') {
      const { patientName, patientPhone, appointmentTime } = args

      // Parse appointment time and insert into database
      const { data, error } = await supabaseAdmin
        .from('appointments')
        .insert({
          practice_id: practiceId,
          patient_id: null, // Would be set during patient lookup
          scheduled_at: appointmentTime,
          duration_minutes: 60,
          status: 'scheduled',
          created_at: new Date().toISOString(),
        })
        .select()

      if (error) {
        console.error('Error booking appointment:', error)
      } else {
        console.log(`✓ Appointment booked: ${appointmentTime}`)
      }
    }

    // Example: getting practice info
    if (name === 'get_practice_info') {
      const { data, error } = await supabaseAdmin
        .from('practices')
        .select('*')
        .eq('id', practiceId)
        .single()

      if (data) {
        console.log(`✓ Practice info retrieved`)
      }
    }
  } catch (error) {
    console.error('Error in handleFunctionCall:', error)
  }
}

/**
 * Handle GET requests (Vapi may test the webhook)
 */
export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
