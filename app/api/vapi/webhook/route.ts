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
    system_prompt_notes: practice.system_prompt || '',
    emotional_support_enabled: true,
  })

  const aiName = practice.ai_name || 'Ellie'
  const greeting = practice.greeting || `Hi there, thank you for calling ${practice.name}. This is ${aiName}. How can I help you today?`

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
        voiceId: 'EXAVITQu4vr4xnSDxMaL',
        model: 'eleven_turbo_v2_5',
        stability: 0.45,
        similarityBoost: 0.8,
        speed: 0.7,
        style: 0.25,
        useSpeakerBoost: true,
      },
      transcriber: {
        provider: 'deepgram',
        model: 'nova-2',
      },
      backgroundSound: 'office',
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
  // FIX: Calculate duration from Vapi timestamps if call.duration is 0
  let duration = call.duration || 0
  if (!duration && call.startedAt && call.endedAt) {
    duration = Math.round((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000)
    console.log(`[Vapi] Duration calculated from timestamps: ${duration}s`)
  }
  if (!duration && message.durationSeconds) {
    duration = message.durationSeconds
    console.log(`[Vapi] Duration from message.durationSeconds: ${duration}s`)
  }
  const customerPhone = call.customer?.number || ''

  console.log(`[Vapi] Call ended: ${vapiCallId} | reason: ${endedReason} | duration: ${duration}s | caller: ${customerPhone || '(unknown)'}`)

  // Fallback: look up practice by the called phone number if metadata is missing
  if (!practiceId) {
    const calledNumber = call.phoneNumber?.number
      || call.phoneNumber?.twilioPhoneNumber
      || (typeof call.phoneNumber === 'string' && call.phoneNumber.startsWith('+') ? call.phoneNumber : '')
      || ''
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
        practiceName = data.name
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
      practiceName = practices[0].name
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

// ---- Helper: retry extractCallInformation on transient API errors ----
async function extractWithRetry(transcriptText: string, maxRetries = 2): Promise<any> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const info = await extractCallInformation(transcriptText)
      return info
    } catch (err: any) {
      const isOverloaded = err?.message?.includes('overloaded') ||
                           err?.status === 529 ||
                           err?.error?.type === 'overloaded_error'
      if (isOverloaded && attempt < maxRetries) {
        const delay = 1000 * (attempt + 1) // 1s, 2s backoff
        console.log(`[Vapi] Claude API overloaded, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      throw err
    }
  }
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
    practiceId,
    practiceName,
    vapiCallId,
    transcriptText,
    duration,
    customerPhone,
    endedReason,
    summary,
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
  // FIX: Check Supabase {error} return instead of relying on try/catch
  // (Supabase JS v2 does NOT throw on errors â it returns {data, error})
  const { error: callLogError } = await supabaseAdmin.from('call_logs').upsert({
    practice_id: practiceId,
    vapi_call_id: vapiCallId || null,
    patient_phone: customerPhone || 'unknown',
    duration_seconds: Math.round(duration),
    transcript: transcriptText,
    summary: callSummary,
    ended_reason: endedReason,
    crisis_detected: crisisDetected,
    created_at: new Date().toISOString(),
  }, { onConflict: 'vapi_call_id' })

  if (callLogError) {
    console.error('[Vapi] Failed to upsert call log:', callLogError.message, callLogError.details)
    // Fallback: try plain insert (in case upsert conflict on empty/null vapi_call_id)
    const { error: insertError } = await supabaseAdmin.from('call_logs').insert({
      practice_id: practiceId,
      vapi_call_id: vapiCallId || null,
      patient_phone: customerPhone || 'unknown',
      duration_seconds: Math.round(duration),
      transcript: transcriptText,
      summary: callSummary,
      ended_reason: endedReason,
      crisis_detected: crisisDetected,
      created_at: new Date().toISOString(),
    })
    if (insertError) {
      console.error('[Vapi] Fallback insert also failed:', insertError.message)
    } else {
      console.log(`[Vapi] Call log saved via fallback insert: ${vapiCallId}`)
    }
  } else {
    console.log(`[Vapi] Call log saved: ${vapiCallId}`)
  }

  // 4. Extract patient info and auto-create patient record
  // FIX: Retry Claude API on overloaded errors + create patient with minimal info
  let info: any = {}
  try {
    info = await extractWithRetry(transcriptText, 2)
    console.log('[Vapi] Patient info extracted:', JSON.stringify({
      name: info.patientName,
      phone: info.patientPhone,
      email: info.patientEmail,
    }))
  } catch (extractErr: any) {
    console.error('[Vapi] Claude extraction failed after retries, using regex fallback:', extractErr?.message || extractErr)
    // Enhanced regex fallback
    const nameMatch = transcriptText.match(
      /(?:my name is|this is|i'm|i am|name's)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i
    )
    const phoneMatch = transcriptText.match(
      /(?:phone|number|reach me|call me|text me|contact).*?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i
    )
    const emailMatch = transcriptText.match(
      /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i
    )
    const insuranceMatch = transcriptText.match(
      /(?:insurance|provider|plan).*?((?:Blue ?Cross|Aetna|Cigna|United|UHC|Kaiser|Humana|Anthem|BCBS|Tricare|Medicare|Medicaid)[^,.\n]*)/i
    )
    const reasonMatch = transcriptText.match(
      /(?:looking for|need|want|seeking|struggling with|dealing with|help with)\s+(.{10,80}?)(?:\.|,|$)/i
    )
    info = {
      patientName: nameMatch ? nameMatch[1].trim() : undefined,
      patientPhone: phoneMatch ? phoneMatch[1] : undefined,
      patientEmail: emailMatch ? emailMatch[1] : undefined,
      patientInsurance: insuranceMatch ? insuranceMatch[1] : undefined,
      reasonForSeeking: reasonMatch ? reasonMatch[1].trim() : undefined,
    }
    console.log('[Vapi] Regex fallback extracted:', JSON.stringify(info))
  }

  // Determine the best phone number available
  const patientPhone = info.patientPhone || customerPhone || ''

  // Check if patient already exists by phone number
  let existingPatient: any = null
  if (patientPhone) {
    const normalized = patientPhone.replace(/\D/g, '').slice(-10)
    if (normalized.length >= 10) {
      const { data } = await supabaseAdmin
        .from('patients')
        .select('id, first_name, last_name')
        .eq('practice_id', practiceId)
        .ilike('phone', `%${normalized}`)
        .limit(1)
        .maybeSingle()
      existingPatient = data
    }
  }

  // Also check by email if no phone match
  if (!existingPatient && info.patientEmail) {
    const { data } = await supabaseAdmin
      .from('patients')
      .select('id, first_name, last_name')
      .eq('practice_id', practiceId)
      .ilike('email', info.patientEmail)
      .limit(1)
      .maybeSingle()
    existingPatient = data
  }

  let newPatient: any = null

  if (existingPatient) {
    console.log(`[Vapi] Existing patient found: ${existingPatient.first_name} ${existingPatient.last_name} (${existingPatient.id})`)
  } else {
    // FIX: Create patient even with minimal info (phone number only)
    // Previously required a name from extraction â now uses "New Caller" as fallback
    const nameParts = (info.patientName || '').trim().split(/\s+/).filter(Boolean)
    const firstName = nameParts[0] || 'New'
    const lastName = nameParts.slice(1).join(' ') || (nameParts[0] ? '' : 'Caller')

    // Only skip if we have absolutely no identifying info
    if (patientPhone || info.patientEmail || info.patientName) {
      const { data: created, error: patientError } = await supabaseAdmin
        .from('patients')
        .insert({
          practice_id: practiceId,
          first_name: firstName,
          last_name: lastName,
          phone: patientPhone || null,
          email: info.patientEmail || null,
          insurance: info.patientInsurance || null,
          reason_for_seeking: info.reasonForSeeking || null,
        })
        .select('id')
        .single()

      if (patientError) {
        console.error('[Vapi] Failed to create patient:', patientError.message, patientError.details)
      } else if (created) {
        newPatient = created
        console.log(`[Vapi] Patient created: ${firstName} ${lastName} (${created.id})`)
      }
    } else {
      console.log('[Vapi] No patient info available (no phone, email, or name) â skipping patient creation')
    }
  }

  // 4b. FIX: Link patient to call_log and update extracted caller info
  const resolvedPatientId = existingPatient?.id || newPatient?.id
  if (resolvedPatientId || info.patientName) {
    const updateData: any = {
      call_type: existingPatient ? 'returning_patient' : (newPatient ? 'new_patient' : 'unknown'),
    }
    if (resolvedPatientId) updateData.patient_id = resolvedPatientId
    if (info.patientName) updateData.caller_name = info.patientName
    if (duration && duration > 0) updateData.duration_seconds = Math.round(duration)

    const { error: linkError } = await supabaseAdmin
      .from('call_logs')
      .update(updateData)
      .eq('vapi_call_id', vapiCallId)

    if (linkError) {
      console.error('[Vapi] Failed to update call log with patient info:', linkError.message)
    } else {
      console.log(`[Vapi] Call log updated: patient_id=${resolvedPatientId}, caller_name=${info.patientName}, call_type=${updateData.call_type}`)
    }
  }

  // 5. Crisis alert â save and SMS the therapist
  if (crisisDetected) {
    try {
      const { error: crisisError } = await supabaseAdmin.from('crisis_alerts').insert({
        practice_id: practiceId,
        call_id: vapiCallId,
        patient_phone: customerPhone || null,
        severity: crisisLevel === 'immediate' ? 'high' : 'medium',
        transcript_excerpt: transcriptText.slice(0, 500),
        created_at: new Date().toISOString(),
      })
      if (crisisError) console.error('[Vapi] Crisis alert save error:', crisisError.message)

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

  // 7. Auto-send intake forms for NEW patients
  if (newPatient && patientPhone) {
    try {
      // Get the call_log record to pass the ID
      const { data: callLogRecord } = await supabaseAdmin
        .from('call_logs')
        .select('id')
        .eq('vapi_call_id', vapiCallId)
        .single()

      // Determine delivery method: default to SMS since we always have the phone
      // If caller provided an email, send via both
      const deliveryMethod = info.patientEmail ? 'both' : 'sms'

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
      const intakePayload = {
        practice_id: practiceId,
        patient_id: newPatient.id,
        call_log_id: callLogRecord?.id || null,
        patient_phone: patientPhone,
        patient_email: info.patientEmail || null,
        patient_name: info.patientName || null,
        delivery_method: deliveryMethod,
      }

      console.log('[Vapi] Sending intake forms to new patient:', JSON.stringify({
        patient: info.patientName,
        phone: patientPhone,
        email: info.patientEmail || '(none)',
        method: deliveryMethod,
      }))

      const intakeRes = await fetch(`${baseUrl}/api/intake/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(intakePayload),
      })

      if (intakeRes.ok) {
        const intakeResult = await intakeRes.json()
        console.log(`[Vapi] Intake forms sent: sms=${intakeResult.sms_sent}, email=${intakeResult.email_sent}`)
      } else {
        const intakeError = await intakeRes.text()
        console.error('[Vapi] Intake send failed:', intakeRes.status, intakeError)
      }
    } catch (err) {
      console.error('[Vapi] Intake auto-send error:', err)
    }
  }

  // 8. Create appointment record if one was scheduled during the call
  if (info.appointmentScheduled && info.appointmentTime) {
    try {
      const appointmentPatientId = existingPatient?.id || newPatient?.id
      const appointmentData: any = {
        practice_id: practiceId,
        patient_id: appointmentPatientId || null,
        patient_name: info.patientName || null,
        patient_phone: patientPhone || null,
        patient_email: info.patientEmail || null,
        appointment_time: info.appointmentTime,
        status: 'scheduled',
        source: 'ai_call',
        duration_minutes: 60,
      }

      const parsedDate = parseAppointmentDate(info.appointmentTime)
      if (parsedDate) {
        appointmentData.scheduled_at = parsedDate.toISOString()
        appointmentData.appointment_date = parsedDate.toISOString().split('T')[0]
      }

      const { error: apptError } = await supabaseAdmin
        .from('appointments')
        .insert(appointmentData)

      if (apptError) {
        console.error('[Vapi] Failed to create appointment:', apptError.message)
      } else {
        console.log(`[Vapi] Appointment created: ${info.appointmentTime} for ${info.patientName || patientPhone}`)
      }
    } catch (err) {
      console.error('[Vapi] Appointment creation error:', err)
    }
  }
}

// ---- Tool handlers ----

async function handleCollectIntake(params: any, practiceId: string | null): Promise<string> {
  const { name, phone, insurance, telehealthPreference, reason, preferredTimes } = params

  if (!practiceId) {
    return 'Intake information has been recorded. The practice team will follow up within one business day to confirm the appointment.'
  }

  try {
    const nameParts = (name || '').trim().split(/\s+/).filter(Boolean)
    const firstName = nameParts[0] || ''
    const lastName = nameParts.slice(1).join(' ') || ''
    const normalizedPhone = phone?.replace(/\D/g, '').slice(-10) || ''

    let patientId: string | null = null

    if (normalizedPhone && normalizedPhone.length >= 10) {
      const { data: existing } = await supabaseAdmin
        .from('patients')
        .select('id')
        .eq('practice_id', practiceId)
        .ilike('phone', `%${normalizedPhone}`)
        .limit(1)
        .maybeSingle()

      if (existing) {
        patientId = existing.id
      }
    }

    if (patientId) {
      const updates: Record<string, any> = { updated_at: new Date().toISOString() }
      if (firstName) updates.first_name = firstName
      if (lastName) updates.last_name = lastName
      if (insurance) updates.insurance_provider = insurance
      if (reason) updates.reason_for_seeking = reason
      if (telehealthPreference) updates.telehealth_preference = telehealthPreference
      if (preferredTimes) updates.preferred_times = preferredTimes

      await supabaseAdmin
        .from('patients')
        .update(updates)
        .eq('id', patientId)

      console.log(`[Vapi] Updated existing patient ${patientId} with intake info from call`)
    } else {
      const { data: created, error: createErr } = await supabaseAdmin
        .from('patients')
        .insert({
          practice_id: practiceId,
          first_name: firstName || 'New',
          last_name: lastName || 'Caller',
          phone: phone || null,
          insurance_provider: insurance || null,
          reason_for_seeking: reason || null,
          telehealth_preference: telehealthPreference || null,
          preferred_times: preferredTimes || null,
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (createErr) {
        console.error('[Vapi] Failed to create patient from intake tool:', createErr.message)
      } else {
        console.log(`[Vapi] Created new patient ${created?.id} from intake tool call`)
      }
    }
  } catch (err) {
    console.error('[Vapi] Intake tool handler error:', err)
  }

  return 'Intake information has been recorded. The practice team will follow up within one business day to confirm the appointment.'
}

async function handleCheckAvailability(params: any, practiceId: string | null): Promise<string> {
  const { preferredDay, preferredTime } = params
  return `I have noted your preference for ${preferredDay || 'a convenient day'} ${preferredTime ? `around ${preferredTime}` : ''}. The scheduling team will check availability and get back to you within one business day to confirm a time.`
}

async function handleTakeMessage(params: any, practiceId: string | null): Promise<string> {
  const { callerName, phone, message: msg } = params

  if (!practiceId) {
    return 'Your message has been recorded. The therapist will get back to you as soon as possible.'
  }

  try {
    const nameParts = (callerName || '').trim().split(/\s+/).filter(Boolean)
    const firstName = nameParts[0] || ''
    const lastName = nameParts.slice(1).join(' ') || ''
    const normalizedPhone = phone?.replace(/\D/g, '').slice(-10) || ''

    let patientId: string | null = null

    if (normalizedPhone && normalizedPhone.length >= 10) {
      const { data: existing } = await supabaseAdmin
        .from('patients')
        .select('id')
        .eq('practice_id', practiceId)
        .ilike('phone', `%${normalizedPhone}`)
        .limit(1)
        .maybeSingle()

      if (existing) {
        patientId = existing.id
      }
    }

    if (!patientId && (firstName || normalizedPhone)) {
      const { data: created } = await supabaseAdmin
        .from('patients')
        .insert({
          practice_id: practiceId,
          first_name: firstName || 'Unknown',
          last_name: lastName || 'Caller',
          phone: phone || null,
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (created) {
        patientId = created.id
        console.log(`[Vapi] Created patient ${patientId} from takeMessage tool`)
      }
    }

    await supabaseAdmin.from('tasks').insert({
      practice_id: practiceId,
      type: 'message',
      patient_name: callerName || 'Unknown Caller',
      patient_phone: phone || null,
      summary: msg || 'No message provided',
      status: 'pending',
      created_at: new Date().toISOString(),
    })

    console.log(`[Vapi] Message saved as task for patient ${patientId || '(unknown)'}`)
  } catch (err) {
    console.error('[Vapi] TakeMessage handler error:', err)
  }

  return 'Your message has been recorded. The therapist will get back to you as soon as possible.'
}

async function handleSubmitScreening(params: any, practiceId: string | null): Promise<string> {
  const { phq2Score, gad2Score, patientName } = params

  if (practiceId) {
    try {
      const nameParts = (patientName || '').trim().split(/\s+/).filter(Boolean)

      let patientId: string | null = null
      if (nameParts.length > 0) {
        const { data: found } = await supabaseAdmin
          .from('patients')
          .select('id')
          .eq('practice_id', practiceId)
          .ilike('first_name', nameParts[0])
          .limit(1)
          .maybeSingle()

        if (found) patientId = found.id
      }

      const totalScore = (parseInt(phq2Score) || 0) + (parseInt(gad2Score) || 0)
      const severity = totalScore >= 6 ? 'severe' : totalScore >= 3 ? 'moderate' : 'mild'

      await supabaseAdmin.from('outcome_assessments').insert({
        practice_id: practiceId,
        patient_name: patientName || null,
        assessment_type: 'phq2_gad2_phone',
        status: 'completed',
        score: totalScore,
        severity: severity,
        responses: { phq2: phq2Score || 0, gad2: gad2Score || 0 },
        completed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      })

      console.log(`[Vapi] Phone screening saved for patient ${patientId || '(unknown)'}: PHQ-2=${phq2Score}, GAD-2=${gad2Score}`)
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
      voiceId: 'EXAVITQu4vr4xnSDxMaL',
        model: 'eleven_turbo_v2_5',
        stability: 0.45,
        similarityBoost: 0.8,
        speed: 0.7,
        style: 0.25,
        useSpeakerBoost: true,
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

function parseAppointmentDate(timeStr: string): Date | null {
  if (!timeStr) return null
  const now = new Date()
  const lower = timeStr.toLowerCase()
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  let targetDate: Date | null = null
  if (lower.includes('tomorrow')) {
    targetDate = new Date(now)
    targetDate.setDate(targetDate.getDate() + 1)
  }
  if (!targetDate) {
    for (let i = 0; i < dayNames.length; i++) {
      if (lower.includes(dayNames[i])) {
        const currentDay = now.getDay()
        let daysUntil = i - currentDay
        if (daysUntil <= 0) daysUntil += 7
        targetDate = new Date(now)
        targetDate.setDate(targetDate.getDate() + daysUntil)
        break
      }
    }
  }
  if (!targetDate) {
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december']
    const monthDayMatch = lower.match(/(\w+)\s+(\d{1,2})/)
    if (monthDayMatch) {
      const monthIdx = months.indexOf(monthDayMatch[1])
      if (monthIdx >= 0) {
        targetDate = new Date(now.getFullYear(), monthIdx, parseInt(monthDayMatch[2]))
        if (targetDate < now) targetDate.setFullYear(targetDate.getFullYear() + 1)
      }
    }
  }
  if (!targetDate) return null
  let hours = 9
  let minutes = 0
  if (lower.includes('noon')) {
    hours = 12; minutes = 0
  } else if (lower.includes('morning') && !lower.match(/\d{1,2}/)) {
    hours = 9
  } else if (lower.includes('afternoon') && !lower.match(/\d{1,2}/)) {
    hours = 14
  } else if (lower.includes('evening') && !lower.match(/\d{1,2}/)) {
    hours = 17
  } else {
    const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/)
    if (timeMatch) {
      hours = parseInt(timeMatch[1])
      minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0
      const period = timeMatch[3]
      if (period === 'pm' && hours < 12) hours += 12
      if (period === 'am' && hours === 12) hours = 0
    }
  }
  targetDate.setHours(hours, minutes, 0, 0)
  return targetDate
}
