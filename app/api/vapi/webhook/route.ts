// Vapi.ai webhook handler
// Receives events from Vapi for incoming calls
// Events: call-started, transcript, call-ended, function-call

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateCallSummary } from '@/lib/claude'
import { getCallSummaryPrompt } from '@/lib/ai-prompts'
import type { VapiWebhookPayload } from '@/types'

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
    const { data, error } = await supabaseAdmin
      .from('call_logs')
      .insert({
        practice_id: practiceId,
        patient_phone: phoneNumber,
        duration_seconds: durationSeconds,
        transcript: transcript || null,
        summary: summary,
        vapi_call_id: callId,
        created_at: new Date().toISOString(),
      })
      .select()

    if (error) {
      console.error('Error inserting call log:', error)
    } else {
      console.log(`✓ Call logged: ${callId}`)
    }
  } catch (error) {
    console.error('Error in handleCallEnded:', error)
  }
}

/**
 * Handle function-call event
 * Vapi can call functions during a call for things like:
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
