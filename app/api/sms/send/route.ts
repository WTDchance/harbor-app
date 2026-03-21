// Internal API to send outbound SMS messages
// Used for appointment reminders, confirmations, etc.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendSMS } from '@/lib/twilio'
import type { TwilioSendSMSRequest } from '@/types'

/**
 * POST /api/sms/send
 * Internal endpoint to send SMS messages
 * Called from scheduled jobs, admin actions, etc.
 *
 * Request body:
 * {
 *   "to": "+15551234567",
 *   "body": "Hello, this is your appointment reminder...",
 *   "practiceId": "uuid"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body: TwilioSendSMSRequest = await request.json()
    const { to, body: messageBody, practiceId } = body

    if (!to || !messageBody || !practiceId) {
      return NextResponse.json(
        { error: 'Missing required fields: to, body, practiceId' },
        { status: 400 }
      )
    }

    // Verify practice exists (optional security check)
    const { data: practice, error: practiceError } = await supabaseAdmin
      .from('practices')
      .select('id, phone_number')
      .eq('id', practiceId)
      .single()

    if (!practice || practiceError) {
      console.warn('⚠️ Practice not found:', practiceId)
      return NextResponse.json(
        { error: 'Practice not found' },
        { status: 404 }
      )
    }

    // Send SMS via Twilio
    const messageSid = await sendSMS(to, messageBody)

    if (!messageSid) {
      return NextResponse.json(
        { error: 'Failed to send SMS' },
        { status: 500 }
      )
    }

    // Log the outbound message to conversation
    const { data: conversation } = await supabaseAdmin
      .from('sms_conversations')
      .select('*')
      .eq('practice_id', practiceId)
      .eq('patient_phone', to)
      .single()

    if (conversation) {
      const updatedMessages = [
        ...(conversation.messages_json || []),
        {
          direction: 'outbound',
          content: messageBody,
          timestamp: new Date().toISOString(),
          message_sid: messageSid,
        },
      ]

      await supabaseAdmin
        .from('sms_conversations')
        .update({
          messages_json: updatedMessages,
          last_message_at: new Date().toISOString(),
        })
        .eq('id', conversation.id)
    } else {
      // Create new conversation if doesn't exist
      await supabaseAdmin
        .from('sms_conversations')
        .insert({
          practice_id: practiceId,
          patient_phone: to,
          messages_json: [
            {
              direction: 'outbound',
              content: messageBody,
              timestamp: new Date().toISOString(),
              message_sid: messageSid,
            },
          ],
          created_at: new Date().toISOString(),
        })
    }

    console.log(`✓ SMS sent to ${to}: ${messageSid}`)

    return NextResponse.json({
      success: true,
      messageSid: messageSid,
    })
  } catch (error) {
    console.error('❌ Error sending SMS:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Note: sendAppointmentReminders helper has been moved to lib/reminders.ts
