// Harbor AI Receptionist - Vapi Webhook Handler
// Handles: assistant-request, tool-calls, function-call, end-of-call-report, status-update, hang

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateCallSummary, extractCallInformation, detectCrisisIndicators } from '@/lib/claude'
import { getCallSummaryPrompt } from '@/lib/ai-prompts'
import { sendEmail, buildCallSummaryEmail } from '@/lib/email'
import { buildSystemPrompt } from '@/lib/systemPrompt'
import twilio from 'twilio'
import { formatPhoneNumber } from '@/lib/twilio'

// ---- Crisis keyword lists ----

const IMMEDIATE_CRISIS = [
  'kill myself', 'end my life', 'take my own life', 'suicide', 'suicidal',
  'want to die', 'rather be dead', 'better off dead', 'ending it all',
  'going to hurt myself', 'going to harm myself', 'overdose',
]

const CRISIS_CONCERNS = [
  'not worth living', 'no reason to live', 'can\'t go on', 'hopeless',
  'giving up', 'no way out', 'burden to everyone', 'nobody cares',
  'want it to stop', 'can\'t take it anymore', 'self-harm', 'cutting',
  'hurting myself',
]

// ---- POST handler ----

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const message = body.message || body

    // Verify webhook secret if configured
    const secret = request.nextUrl.searchParams.get('secret')
    if (process.env.VAPI_WEBHOOK_SECRET && secret !== process.env.VAPI_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const messageType = message.type
    console.log(`[Vapi] Event: ${messageType}`)

    switch (messageType) {
      case 'assistant-request':
        return handleAssistantRequest(message)

      case 'tool-calls':
        return handleToolCalls(message)

      case 'function-call':
        return handleFunctionCall(message)

      case 'end-of-call-report':
        return handleEndOfCallReport(message)

      case 'status-update':
      case 'hang':
      case 'speech-update':
      case 'transcript':
        return NextResponse.json({ ok: true })

      default:
        console.log(`[Vapi] Unhandled event type: ${messageType}`)
        return NextResponse.json({ ok: true })
    }
  } catch (error) {
    console.error('[Vapi] Webhook error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Also handle GET for health checks
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'harbor-vapi-webhook' })
}

// ---- assistant-request ----
// Vapi sends this when an inbound call arrives. We look up the practice
// by phone number and return a transient assistant config.

async function handleAssistantRequest(message: any) {
  const call = message.call || {}
  const phoneNumber = call.phoneNumber?.number || call.phoneNumberId || ''

  console.log(`[Vapi] Inbound call to: ${phoneNumber}`)

  // Look up practice by phone number
  let practice: any = null
  if (phoneNumber) {
    const normalized = phoneNumber.replace(/\D/g, '').slice(-10)
    const { data } = await supabaseAdmin
      .from('practices')
      .select('*')
      .or(`phone_number.ilike.%${normalized}`)
      .limit(1)
      .single()
    practice = data
  }

  // Fallback if no practice found
  if (!practice) {
    console.warn('[Vapi] No practice found for number:', phoneNumber)
    return NextResponse.json({
      assistant: buildFallbackAssistant(),
    })
  }

  console.log(`[Vapi] Matched practice: ${practice.name} (${practice.id})`)

  // Build dynamic system prompt from practice config
  const systemPrompt = buildSystemPrompt({
    therapist_name: practice.provider_name || practice.name,
    practice_name: practice.name,
    ai_name: practice.ai_name || 'Ellie',
    specialties: practice.specialties || [],
    hours: formatHours(practice.hours_json),
    location: practice.location || '',
    telehealth: practice.telehealth_available || false,
    insurance_accepted: practice.insurance_accepted || [],
    system_prompt_notes: practice.system_prompt_notes || '',
    emotional_support_enabled: true,
  })

  const aiName = practice.ai_name || 'Ellie'
  const greeting = `Hi there, thank you for calling ${practice.name}. This is ${aiName}. How can I help you today?`

  // Build the webhook URL for tool call callbacks
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
  const webhookSecret = process.env.VAPI_WEBHOOK_SECRET
  const serverUrl = `${baseUrl}/api/vapi/webhook${webhookSecret ? '?secret=' + webhookSecret : ''}`

  return NextResponse.json({
    assistant: {
      name: `${aiName} - ${practice.name}`,
      firstMessage: greeting,
      model: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
        ],
      },
      voice: {
        provider: '11labs',
        voiceId: '21m00Tcm4TlvDq8ikWAM',
      },
      transcriber: {
        provider: 'deepgram',
        model: 'nova-2',
      },
      serverUrl: serverUrl,
      endCallFunctionEnabled: true,
      recordingEnabled: true,
      silenceTimeoutSeconds: 30,
      maxDurationSeconds: 1800,
      tools: buildTools(serverUrl),
      metadata: {
        practiceId: practice.id,
        practiceName: practice.name,
      },
    },
  })
}

// ---- tool-calls (new Vapi format) ----

async function handleToolCalls(message: any) {
  const toolCallList = message.toolWithToolCallList || []
  const call = message.call || {}
  let practiceId = call.assistant?.metadata?.practiceId || null

  // Fallback: look up practice by phone number if metadata missing
  if (!practiceId) {
    const calledNumber = call.phoneNumber?.number || call.phoneNumberId || ''
    if (calledNumber) {
      const normalized = calledNumber.replace(/\D/g, '').slice(-10)
      const { data } = await supabaseAdmin
        .from('practices')
        .select('id')
        .or(`phone_number.ilike.%${normalized}`)
        .limit(1)
        .single()
      if (data) practiceId = data.id
    }
  }

  const results = []

  for (const item of toolCallList) {
    const toolName = item.function?.name || item.name || ''
    const toolCallId = item.toolCall?.id || item.id || ''
    const params = item.toolCall?.function?.arguments
      ? (typeof item.toolCall.function.arguments === 'string'
        ? JSON.parse(item.toolCall.function.arguments)
        : item.toolCall.function.arguments)
      : item.function?.arguments || {}

    console.log(`[Vapi] Tool call: ${toolName}`, params)

    let result = ''
    try {
      switch (toolName) {
        case 'collectIntakeInfo':
          result = await handleCollectIntake(params, practiceId)
          break
        case 'checkAvailability':
          result = await handleCheckAvailability(params, practiceId)
          break
        case 'takeMessage':
          result = await handleTakeMessage(params, practiceId)
          break
        case 'submitIntakeScreening':
          result = await handleSubmitScreening(params, practiceId)
          break
        default:
          result = `Unknown tool: ${toolName}`
      }
    } catch (err) {
      console.error(`[Vapi] Tool error (${toolName}):`, err)
      result = 'Sorry, I had trouble processing that. Let me take a note for the team.'
    }

    results.push({
      name: toolName,
      toolCallId: toolCallId,
      result: result,
    })
  }

  return NextResponse.json({ results })
}

// ---- function-call (legacy Vapi format) ----

async function handleFunctionCall(message: any) {
  const fn = message.functionCall || {}
  const toolName = fn.name || ''
  const params = fn.parameters || {}
  const call = message.call || {}
  let practiceId = call.assistant?.metadata?.practiceId || null

  // Fallback: look up practice by phone number if metadata missing
  if (!practiceId) {
    const calledNumber = call.phoneNumber?.number || call.phoneNumberId || ''
    if (calledNumber) {
      const normalized = calledNumber.replace(/\D/g, '').slice(-10)
      const { data } = await supabaseAdmin
        .from('practices')
        .select('id')
        .or(`phone_number.ilike.%${normalized}`)
        .limit(1)
        .single()
      if (data) practiceId = data.id
    }
  }

  console.log(`[Vapi] Function call: ${toolName}`, params)

  let result = ''
  try {
    switch (toolName) {
      case 'collectIntakeInfo':
        result = await handleCollectIntake(params, practiceId)
        break
      case 'checkAvailability':
        result = await handleCheckAvailability(params, practiceId)
        break
      case 'takeMessage':
        result = await handleTakeMessage(params, practiceId)
        break
      case 'submitIntakeScreening':
        result = await handleSubmitScreening(params, practiceId)
        break
      default:
        result = `Unknown function: ${toolName}`
    }
  } catch (err) {
    console.error(`[Vapi] Function error (${toolName}):`, err)
    result = 'Sorry, I had trouble processing that.'
  }

  return NextResponse.json({ result })
}

// ---- end-of-call-report ----

async function handleEndOfCallReport(message: any) {
  const call = message.call || {}
  const artifact = message.artifact || {}
  let practiceId = call.assistant?.metadata?.practiceId || null
  let practiceName = call.assistant?.metadata?.practiceName || 'Unknown Practice'

  const transcript = artifact.transcript || ''
  const messages = artifact.messages || []
  const vapiCallId = call.id || ''
  const endedReason = message.endedReason || 'unknown'
  const duration = call.duration || 0
  const customerPhone = call.customer?.number || ''

  console.log(`[Vapi] Call ended: ${vapiCallId} | reason: ${endedReason} | duration: ${duration}s`)

  // Fallback: look up practice by the called phone number if metadata is missing
  if (!practiceId) {
    // Extract the actual phone number - do NOT use phoneNumberId (it's a Vapi UUID, not a number)
    const calledNumber = call.phoneNumber?.number || call.phoneNumber?.twilioPhoneNumber ||
      (typeof call.phoneNumber === 'string' && call.phoneNumber.startsWith('+') ? call.phoneNumber : '') || ''
    console.log(`[Vapi] No practice ID in metadata, looking up by phone: ${calledNumber || '(none)'}`)
    if (calledNumber) {
      const normalized = calledNumber.replace(/\D/g, '').slice(-10)
      const { data } = await supabaseAdmin
        .from('practices')
        .select('id, name')
        .or(`phone_number.ilike.%${normalized},phone_number.ilike.%${calledNumber}`)
        .limit(1)
        .maybeSingle()
      if (data) {
        practiceId = data.id
        console.log(`[Vapi] Resolved practice by phone: ${data.name} (${data.id})`)
      }
    }
  }

  // Final fallback: if still no practice ID, try single-practice lookup
  if (!practiceId) {
    const { data: practices } = await supabaseAdmin
      .from('practices')
      .select('id, name')
      .limit(2)
    if (practices && practices.length === 1) {
      practiceId = practices[0].id
      console.log(`[Vapi] Resolved practice by single-practice fallback: ${practices[0].name} (${practices[0].id})`)
    } else {
      console.warn('[Vapi] No practice ID found by any method, skipping post-processing')
      return NextResponse.json({ ok: true })
    }
  }

  // Build transcript text from messages if not provided directly
  const transcriptText = transcript || messages
    .map((m: any) => `${m.role === 'assistant' ? 'AI' : 'Caller'}: ${m.message || m.content || ''}`)
    .join('\n')

  if (!transcriptText || transcriptText.length < 20) {
    console.log('[Vapi] Transcript too short, skipping post-processing')
    return NextResponse.json({ ok: true })
  }

  // Run post-call processing in background (don't block the webhook response)
  processEndOfCall({
    practiceId,
    practiceName,
    vapiCallId,
    transcriptText,
    duration,
    customerPhone,
    endedReason,
    summary: artifact.summary || '',
  }).catch((err) => console.error('[Vapi] Post-call processing error:', err))

  return NextResponse.json({ ok: true })
}

// ---- Post-call background processing ----

async function processEndOfCall(opts: {
  practiceId: string
  practiceName: string
  vapiCallId: string
  transcriptText: string
  duration: number
  customerPhone: string
  endedReason: string
  summary: string
}) {
  const {
    practiceId, practiceName, vapiCallId, transcriptText,
    duration, customerPhone, endedReason, summary,
  } = opts

  // 1. Generate summary (use Vapi's if available, otherwise Claude)
  let callSummary = summary
  if (!callSummary || callSummary.length < 10) {
    try {
      callSummary = await generateCallSummary(transcriptText, getCallSummaryPrompt())
    } catch {
      callSummary = 'Summary generation failed'
    }
  }

  // 2. Crisis detection
  // Tier 1: fast keyword scan
  const transcriptLower = transcriptText.toLowerCase()
  let crisisDetected = false
  let crisisLevel = ''

  for (const phrase of IMMEDIATE_CRISIS) {
    if (transcriptLower.includes(phrase)) {
      crisisDetected = true
      crisisLevel = 'immediate'
      break
    }
  }

  if (!crisisDetected) {
    for (const phrase of CRISIS_CONCERNS) {
      if (transcriptLower.includes(phrase)) {
        crisisLevel = 'concern'
        break
      }
    }
  }

  // Tier 2: Claude deep analysis (only if keywords flagged something)
  if (crisisLevel && !crisisDetected) {
    try {
      crisisDetected = await detectCrisisIndicators(transcriptText)
    } catch {
      crisisDetected = crisisLevel === 'immediate'
    }
  }

  // 3. Save call log to Supabase
  try {
    await supabaseAdmin.from('call_logs').upsert({
      practice_id: practiceId,
      vapi_call_id: vapiCallId,
      patient_phone: customerPhone || null,
      duration_seconds: duration,
      transcript: transcriptText,
      summary: callSummary,
      ended_reason: endedReason,
      crisis_detected: crisisDetected,
      created_at: new Date().toISOString(),
    }, { onConflict: 'vapi_call_id' })

    console.log(`[Vapi] Call log saved: ${vapiCallId}`)
  } catch (err) {
    console.error('[Vapi] Failed to save call log:', err)
  }

  // 4. Extract patient info and auto-create patient record
  try {
    const info = await extractCallInformation(transcriptText)
    if (info.patientName && info.patientName.trim()) {
      const nameParts = info.patientName.trim().split(/\s+/)
      const firstName = nameParts[0] || ''
      const lastName = nameParts.slice(1).join(' ') || ''

      if (firstName) {
        const phone = info.patientPhone || customerPhone || ''
        let existingPatient = null

        if (phone) {
          const normalized = phone.replace(/\D/g, '').slice(-10)
          const { data } = await supabaseAdmin
            .from('patients')
            .select('id')
            .eq('practice_id', practiceId)
            .ilike('phone', `%${normalized}`)
            .limit(1)
            .single()
          existingPatient = data
        }

        if (!existingPatient) {
          await supabaseAdmin.from('patients').insert({
            practice_id: practiceId,
            first_name: firstName,
            last_name: lastName,
            phone: phone || null,
            email: info.patientEmail || null,
            insurance: info.patientInsurance || null,
            reason_for_seeking: info.reasonForSeeking || null,
          })
          console.log(`[Vapi] Patient created: ${firstName} ${lastName}`)
        }
      }
    }
  } catch (err) {
    console.error('[Vapi] Failed to extract/create patient:', err)
  }

  // 5. Crisis alert - save and SMS the therapist
  if (crisisDetected) {
    try {
      await supabaseAdmin.from('crisis_alerts').insert({
        practice_id: practiceId,
        call_id: vapiCallId,
        patient_phone: customerPhone || null,
        severity: crisisLevel === 'immediate' ? 'high' : 'medium',
        transcript_excerpt: transcriptText.slice(0, 500),
        created_at: new Date().toISOString(),
      })

      const { data: practiceData } = await supabaseAdmin
        .from('practices')
        .select('phone_number')
        .eq('id', practiceId)
        .single()

      if (practiceData?.phone_number && process.env.TWILIO_ACCOUNT_SID) {
        const twilioClient = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        )
        await twilioClient.messages.create({
          body: `HARBOR CRISIS ALERT: A caller ${customerPhone ? `(${customerPhone})` : ''} showed signs of crisis during their call with ${practiceName}. 988 referral was provided. Please review the call log in your dashboard.`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: practiceData.phone_number,
        })
        console.log('[Vapi] Crisis SMS sent to therapist')
      }
    } catch (err) {
      console.error('[Vapi] Crisis alert error:', err)
    }
  }

  // 6. Email notification to practice staff
  try {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('practice_id', practiceId)
      .limit(5)

    if (users && users.length > 0) {
      const emailData = buildCallSummaryEmail({
        practiceName,
        crisisDetected,
      })

      for (const user of users) {
        if (user.email) {
          await sendEmail({
            to: user.email,
            subject: emailData.subject,
            html: emailData.html,
            from: emailData.from,
          })
        }
      }
      console.log(`[Vapi] Email notifications sent to ${users.length} staff`)
    }
  } catch (err) {
    console.error('[Vapi] Email notification error:', err)
  }
}

// ---- Tool handlers ----

async function handleCollectIntake(params: any, practiceId: string | null): Promise<string> {
  const { name, phone, insurance, telehealthPreference, reason, preferredTimes } = params

  if (practiceId) {
    try {
      await supabaseAdmin.from('intake_submissions').insert({
        practice_id: practiceId,
        patient_name: name || '',
        patient_phone: phone || '',
        insurance: insurance || '',
        telehealth_preference: telehealthPreference || '',
        reason_for_seeking: reason || '',
        preferred_times: preferredTimes || '',
        created_at: new Date().toISOString(),
      })
    } catch (err) {
      console.error('[Vapi] Intake save error:', err)
    }
  }

  return 'Intake information has been recorded. The practice team will follow up within one business day to confirm the appointment.'
}

async function handleCheckAvailability(params: any, practiceId: string | null): Promise<string> {
  const { preferredDay, preferredTime } = params
  return `I have noted your preference for ${preferredDay || 'a convenient day'} ${preferredTime ? `around ${preferredTime}` : ''}. The scheduling team will check availability and get back to you within one business day to confirm a time.`
}

async function handleTakeMessage(params: any, practiceId: string | null): Promise<string> {
  const { callerName, phone, message: msg } = params

  if (practiceId) {
    try {
      await supabaseAdmin.from('intake_submissions').insert({
        practice_id: practiceId,
        patient_name: callerName || '',
        patient_phone: phone || '',
        reason_for_seeking: `Message: ${msg || 'No message provided'}`,
        created_at: new Date().toISOString(),
      })
    } catch (err) {
      console.error('[Vapi] Message save error:', err)
    }
  }

  return 'Your message has been recorded. The therapist will get back to you as soon as possible.'
}

async function handleSubmitScreening(params: any, practiceId: string | null): Promise<string> {
  const { phq2Score, gad2Score, patientName } = params

  if (practiceId) {
    try {
      await supabaseAdmin.from('intake_submissions').upsert({
        practice_id: practiceId,
        patient_name: patientName || '',
        phq2_score: phq2Score || 0,
        gad2_score: gad2Score || 0,
        screening_completed: true,
        created_at: new Date().toISOString(),
      })
    } catch (err) {
      console.error('[Vapi] Screening save error:', err)
    }
  }

  const phq = parseInt(phq2Score) || 0
  const gad = parseInt(gad2Score) || 0

  if (phq >= 3 || gad >= 3) {
    return 'Thank you for sharing that. I want to make sure the therapist has this information before your appointment so they can provide you with the best care.'
  }
  return 'Thank you for answering those questions. That information will help the therapist prepare for your first session.'
}

// ---- Helpers ----

function buildTools(serverUrl: string) {
  return [
    {
      type: 'function',
      function: {
        name: 'collectIntakeInfo',
        description: 'Save patient intake information when they want to schedule an appointment',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Patient full name' },
            phone: { type: 'string', description: 'Patient phone number' },
            insurance: { type: 'string', description: 'Insurance provider or self-pay' },
            telehealthPreference: { type: 'string', description: 'telehealth or in-person' },
            reason: { type: 'string', description: 'Brief reason for seeking therapy' },
            preferredTimes: { type: 'string', description: 'Preferred days and times' },
          },
          required: ['name', 'phone'],
        },
      },
      async: false,
      server: { url: serverUrl },
    },
    {
      type: 'function',
      function: {
        name: 'checkAvailability',
        description: 'Check appointment availability for a given day and time preference',
        parameters: {
          type: 'object',
          properties: {
            preferredDay: { type: 'string', description: 'Preferred day of the week' },
            preferredTime: { type: 'string', description: 'Preferred time (morning, afternoon, evening)' },
          },
        },
      },
      async: false,
      server: { url: serverUrl },
    },
    {
      type: 'function',
      function: {
        name: 'takeMessage',
        description: 'Record a message for the therapist when the caller wants to leave a message',
        parameters: {
          type: 'object',
          properties: {
            callerName: { type: 'string', description: 'Name of the caller' },
            phone: { type: 'string', description: 'Callback phone number' },
            message: { type: 'string', description: 'The message for the therapist' },
          },
          required: ['callerName'],
        },
      },
      async: false,
      server: { url: serverUrl },
    },
    {
      type: 'function',
      function: {
        name: 'submitIntakeScreening',
        description: 'Submit PHQ-2 and GAD-2 screening scores after asking the 4 screening questions',
        parameters: {
          type: 'object',
          properties: {
            patientName: { type: 'string', description: 'Patient name' },
            phq2Score: { type: 'number', description: 'PHQ-2 depression score (0-6)' },
            gad2Score: { type: 'number', description: 'GAD-2 anxiety score (0-6)' },
          },
          required: ['phq2Score', 'gad2Score'],
        },
      },
      async: false,
      server: { url: serverUrl },
    },
  ]
}

function buildFallbackAssistant() {
  return {
    name: 'Harbor Receptionist',
    firstMessage: 'Thank you for calling. How can I help you today?',
    model: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a friendly receptionist for a therapy practice. Help callers with basic questions and offer to take a message. If someone is in crisis, direct them to call 988 or 911.',
        },
      ],
    },
    voice: {
      provider: '11labs',
      voiceId: '21m00Tcm4TlvDq8ikWAM',
    },
    transcriber: {
      provider: 'deepgram',
      model: 'nova-2',
    },
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 600,
  }
}

function formatHours(hoursJson: any): string {
  if (!hoursJson) return 'Monday through Friday, 9am to 5pm'
  if (typeof hoursJson === 'string') return hoursJson

  try {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    const parts: string[] = []

    for (const day of days) {
      const hours = hoursJson[day]
      if (hours && hours !== 'closed') {
        parts.push(`${day.charAt(0).toUpperCase() + day.slice(1)}: ${hours}`)
      }
    }

    return parts.length > 0 ? parts.join(', ') : 'Monday through Friday, 9am to 5pm'
  } catch {
    return 'Monday through Friday, 9am to 5pm'
  }
}
