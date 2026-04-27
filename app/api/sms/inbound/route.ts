// Inbound SMS webhook (Wave 41 — ported off lib/twilio)
// Accepts SignalWire LaML and Twilio LaML payloads (identical field names).
// SignalWire dashboard config points here for the AI-receptionist features
// (crisis detection + Claude responder). The bare /api/signalwire/inbound-sms
// route handles STOP/START/HELP-only flows for numbers that don't opt in to AI.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateSMSResponse as claudeGenerateSMS, detectCrisisIndicators } from '@/lib/claude'
import { getSmsReceptionistPrompt } from '@/lib/ai-prompts'
import { generateSMSResponse as generateLaMLResponse, extractPhoneFromSignalWirePayload } from '@/lib/aws/signalwire'
import {
  classifyInboundKeyword,
  recordOptOut,
  clearOptOut,
  stopConfirmationMessage,
  startConfirmationMessage,
  helpMessage,
} from '@/lib/sms-optout'
import { runSmsAgent } from '@/lib/sms-ai-agent'
import { logCommunication } from '@/lib/patientCommunications'
import type { SMSMessage } from '@/types'

/**
 * POST /api/sms/inbound
 * Handles incoming SMS from Twilio webhook
 * This endpoint:
 * 1. Identifies which practice owns the Twilio number
 * 2. Loads conversation history
 * 3. Generates AI response using Claude
 * 4. Saves message to database
 * 5. Sends response back via Twilio
 */
export async function POST(request: NextRequest) {
  try {
    // Parse Twilio webhook payload
    const formData = await request.formData()
    const payload = Object.fromEntries(formData)
    const { from, to, body, messageSid } = extractPhoneFromSignalWirePayload(payload)

    console.log(`💬 SMS received: ${from} -> ${to}`)
    console.log(`Message: ${body}`)

    // Find which practice owns this Twilio number
    const { data: practices, error: practiceError } = await supabaseAdmin
      .from('practices')
      .select('*')
      .eq('phone_number', to)
      .single()

    if (!practices || practiceError) {
      console.error('❌ Could not find practice for number:', to)
      // Still return valid TwiML to Twilio
      return new NextResponse(
        generateLaMLResponse("Sorry, we couldn't process your message."),
        {
          headers: { 'Content-Type': 'application/xml' },
        }
      )
    }

    const practiceId = practices.id
    console.log(`✓ Practice found: ${practices.name}`)

    // --- A2P / TCPA: handle STOP / START / HELP keywords first ---
    const keyword = classifyInboundKeyword(body)
    if (keyword === 'stop') {
      await recordOptOut(practiceId, from, body.trim())
      const confirm = stopConfirmationMessage(practices.name)
      await logSMSMessage(practiceId, from, body, false)
      return new NextResponse(generateLaMLResponse(confirm), {
        headers: { 'Content-Type': 'application/xml' },
      })
    }
    if (keyword === 'start') {
      await clearOptOut(practiceId, from)
      const confirm = startConfirmationMessage(practices.name)
      await logSMSMessage(practiceId, from, body, false)
      return new NextResponse(generateLaMLResponse(confirm), {
        headers: { 'Content-Type': 'application/xml' },
      })
    }
    if (keyword === 'help') {
      const contact = (practices as any).contact_phone || (practices as any).owner_phone || null
      const help = helpMessage(practices.name, contact)
      await logSMSMessage(practiceId, from, body, false)
      return new NextResponse(generateLaMLResponse(help), {
        headers: { 'Content-Type': 'application/xml' },
      })
    }

    // Check for crisis indicators
    const isCrisis = await detectCrisisIndicators(body)
    if (isCrisis) {
      console.warn('⚠️ CRISIS INDICATORS DETECTED')
      const crisisResponse = `I'm concerned about what you've shared. Please reach out to 988 (Suicide & Crisis Lifeline) - text or call, it's free and available 24/7. If you're in immediate danger, please call 911.`

      // Still log the message
      await logSMSMessage(practiceId, from, body, true)

      return new NextResponse(generateLaMLResponse(crisisResponse), {
        headers: { 'Content-Type': 'application/xml' },
      })
    }

    // Load existing conversation with this number
    const { data: conversation } = await supabaseAdmin
      .from('sms_conversations')
      .select('*')
      .eq('practice_id', practiceId)
      .eq('patient_phone', from)
      .single()

    let messages: SMSMessage[] = []
    let conversationId = conversation?.id

    if (conversation) {
      messages = conversation.messages_json || []
    }

    // Load patient info if exists
    const { data: patient } = await supabaseAdmin
      .from('patients')
      .select('*')
      .eq('practice_id', practiceId)
      .eq('phone', from)
      .single()

    // Generate AI response
    const systemPrompt = getSmsReceptionistPrompt(
      practices.name,
      practices.ai_name || 'Sam',
      formatBusinessHours(practices.hours_json),
      practices.insurance_accepted || []
    )

    // Build conversation context with message history
    const conversationHistory: Array<{role: 'user' | 'assistant', content: string}> = messages.map((msg) => ({
      role: (msg.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: msg.content,
    }))

    let aiResponse: string
    try {
      aiResponse = await runSmsAgent({
        practice: practices,
        patient: patient || null,
        from,
        body,
        history: conversationHistory,
      })
    } catch (error) {
      console.error('Error generating agent response, falling back to plain Claude:', error)
      try {
        aiResponse = await claudeGenerateSMS(body, systemPrompt, conversationHistory)
      } catch (err2) {
        console.error('Fallback also failed:', err2)
        aiResponse = `Thanks for your message! Our team will get back to you soon.`
      }
    }

    // Add new messages to conversation
    const newMessages: SMSMessage[] = [
      ...messages,
      {
        direction: 'inbound',
        content: body,
        timestamp: new Date().toISOString(),
        message_sid: messageSid,
      },
      {
        direction: 'outbound',
        content: aiResponse,
        timestamp: new Date().toISOString(),
      },
    ]

    // Save or update conversation in database
    if (conversationId) {
      await supabaseAdmin
        .from('sms_conversations')
        .update({
          messages_json: newMessages,
          last_message_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
    } else {
      const { data: newConv } = await supabaseAdmin
        .from('sms_conversations')
        .insert({
          practice_id: practiceId,
          patient_phone: from,
          messages_json: newMessages,
          last_message_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        })
        .select()
        .single()

      conversationId = newConv?.id
    }

    // Tier 2B: Log both inbound + outbound SMS to patient_communications
    logCommunication({
      practiceId,
      patientId: patient?.id || null,
      patientPhone: from,
      channel: 'sms',
      direction: 'inbound',
      contentSummary: body.slice(0, 500),
      metadata: { message_sid: messageSid, conversation_id: conversationId },
    })
    logCommunication({
      practiceId,
      patientId: patient?.id || null,
      patientPhone: from,
      channel: 'sms',
      direction: 'outbound',
      contentSummary: aiResponse.slice(0, 500),
      metadata: { conversation_id: conversationId },
    })

    console.log(`✓ Message logged and response generated`)

    // Return TwiML XML response to Twilio
    return new NextResponse(generateLaMLResponse(aiResponse), {
      headers: { 'Content-Type': 'application/xml' },
    })
  } catch (error) {
    console.error('❌ SMS webhook error:', error)
    // Return error response
    return new NextResponse(
      generateLaMLResponse('Sorry, we encountered an error. Please try again.'),
      {
        headers: { 'Content-Type': 'application/xml' },
        status: 200, // Twilio expects 200 even on error
      }
    )
  }
}

/**
 * Helper: Log SMS message for audit trail
 */
async function logSMSMessage(
  practiceId: string,
  phoneNumber: string,
  body: string,
  isCrisis: boolean = false
) {
  try {
    await supabaseAdmin.from('sms_conversations').insert({
      practice_id: practiceId,
      patient_phone: phoneNumber,
      messages_json: [
        {
          direction: 'inbound',
          content: body,
          timestamp: new Date().toISOString(),
          metadata: { crisis: isCrisis },
        },
      ],
      created_at: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error logging SMS:', error)
  }
}

/**
 * Helper: Format business hours for display
 */
function formatBusinessHours(hoursJson: any): string {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  const hours = days
    .filter((day) => hoursJson[day.toLowerCase()]?.enabled)
    .map((day) => {
      const dayHours = hoursJson[day.toLowerCase()]
      return `${day}: ${dayHours.openTime} - ${dayHours.closeTime}`
    })

  return hours.length > 0 ? hours.join(', ') : 'Check our website for hours'
}

/**
 * Handle GET requests (Twilio may test the webhook)
 */
export async function GET() {
  return new NextResponse('OK', { status: 200 })
}
