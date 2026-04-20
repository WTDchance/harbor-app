// Harbor AI Receptionist - Vapi Webhook Handler
// Handles: assistant-request, tool-calls, function-call, end-of-call-report, status-update, hang

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateCallSummary, extractCallInformation, detectCrisisIndicators } from '@/lib/claude'
import { getCallSummaryPrompt } from '@/lib/ai-prompts'
import { sendEmail, buildCallSummaryEmail } from '@/lib/email'
import { buildSystemPrompt } from '@/lib/systemPrompt'
import { getCalendarRouter, findFreeSlots } from '@/lib/calendar'
import twilio from 'twilio'
import { formatPhoneNumber } from '@/lib/twilio'
import { analyzeTranscript } from '@/lib/transcriptAnalyzer'
import { logCommunication } from '@/lib/patientCommunications'

// ---- Network-call timeout guard ----
// Vapi streams tool-call results into a live conversation; if we don't respond
// within ~10s the call hits silence-timeout and the caller hears nothing. We
// previously relied on the underlying HTTP client's default timeout, which in
// practice let Google Calendar's listEvents() hang past Vapi's silence window
// (see 4/18/26 test - Ellie said "Let me pull up the calendar" and then went
// silent until the call dropped). Wrap any outbound call that can block on
// the network so we degrade gracefully instead of going mute.
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ---- Shared practice resolution ----
// Resolves the practice ID from Vapi webhook payloads using a robust fallback chain:
// 1. Metadata (set by handleAssistantRequest on outbound config)
// 2. Phone number lookup (the Twilio number that was called)
// 3. Vapi assistant ID → practices.vapi_assistant_id
// 4. Vapi phone number ID → practices.vapi_phone_number_id
async function resolvePracticeId(
  call: any,
  message: any
): Promise<{ practiceId: string | null; practiceName: string; resolvedBy: string }> {
  // Strategy 1: metadata injected by handleAssistantRequest
  const metaPracticeId = call.assistant?.metadata?.practiceId || message.assistant?.metadata?.practiceId || null
  const metaPracticeName = call.assistant?.metadata?.practiceName || message.assistant?.metadata?.practiceName || 'Unknown Practice'
  if (metaPracticeId) {
    return { practiceId: metaPracticeId, practiceName: metaPracticeName, resolvedBy: 'metadata' }
  }

  // Strategy 2: look up by the called phone number
  const calledNumber =
    call.phoneNumber?.number ||
    call.phoneNumber?.twilioPhoneNumber ||
    (typeof call.phoneNumber === 'string' && call.phoneNumber.startsWith('+') ? call.phoneNumber : '') ||
    message.phoneNumber?.number ||
    ''
  if (calledNumber) {
    const normalized = calledNumber.replace(/\D/g, '').slice(-10)
    const { data } = await supabaseAdmin
      .from('practices')
      .select('id, name')
      .or(`phone_number.ilike.%${normalized},phone_number.ilike.%${calledNumber}`)
      .limit(1)
      .maybeSingle()
    if (data) {
      return { practiceId: data.id, practiceName: data.name, resolvedBy: `phone:${calledNumber}` }
    }
  }

  // Strategy 3: look up by Vapi assistant ID
  const assistantId = call.assistantId || call.assistant?.id || message.assistant?.id || ''
  if (assistantId) {
    const { data } = await supabaseAdmin
      .from('practices')
      .select('id, name')
      .eq('vapi_assistant_id', assistantId)
      .limit(1)
      .maybeSingle()
    if (data) {
      return { practiceId: data.id, practiceName: data.name, resolvedBy: `assistant:${assistantId}` }
    }
  }

  // Strategy 4: look up by Vapi phone number ID
  const phoneNumberId = call.phoneNumberId || message.phoneNumberId || ''
  if (phoneNumberId) {
    const { data } = await supabaseAdmin
      .from('practices')
      .select('id, name')
      .eq('vapi_phone_number_id', phoneNumberId)
      .limit(1)
      .maybeSingle()
    if (data) {
      return { practiceId: data.id, practiceName: data.name, resolvedBy: `phoneId:${phoneNumberId}` }
    }
  }

  console.warn('[Vapi] resolvePracticeId: all strategies exhausted', {
    calledNumber: calledNumber || '(none)',
    assistantId: assistantId || '(none)',
    phoneNumberId: phoneNumberId || '(none)',
  })
  return { practiceId: null, practiceName: 'Unknown Practice', resolvedBy: 'none' }
}

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

    // Verify webhook secret if provided (query param or header).
    // Vapi's phone-level serverUrl may strip query params when sending
    // assistant-request, so we accept requests that omit the secret entirely
    // rather than hard-blocking them. The real security boundary is the
    // Supabase admin key — this secret is defense-in-depth only.
    const expectedSecret = process.env.VAPI_WEBHOOK_SECRET
    if (expectedSecret) {
      const secret = request.nextUrl.searchParams.get('secret')
        || request.headers.get('x-vapi-secret')
        || ''
      if (secret && secret !== expectedSecret) {
        // A secret was provided but it's WRONG — reject
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      // If no secret provided at all, allow through (Vapi assistant-request)
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
// and return its static Vapi assistantId. The static assistant is kept
// in sync via /api/admin/repair-practice PATCH (sync_vapi) which pushes
// the latest system prompt, voice settings, and server URL to Vapi's API.
//
// Why not transient assistants? Vapi's transient assistant-request response
// format is fragile and underdocumented — field names and structure differ
// from the Assistant API, causing silent failures ("couldn't get voice
// assistant"). Returning { assistantId } is the guaranteed-working path.
async function handleAssistantRequest(message: any) {
  const call = message.call || {}
  const phoneNumber = call.phoneNumber?.number || call.phoneNumberId || ''
  const customerPhone = call.customer?.number || message.customer?.number || ''
  console.log(`[Vapi] Inbound call to: ${phoneNumber} from: ${customerPhone || '(unknown)'}`)

  const { practiceId, practiceName, resolvedBy } = await resolvePracticeId(call, message)

  if (!practiceId) {
    console.warn('[Vapi] No practice found for number:', phoneNumber)
    return NextResponse.json({ assistant: buildFallbackAssistant() })
  }

  const { data: practice } = await supabaseAdmin
    .from('practices')
    .select(
      `id, vapi_assistant_id, name, ai_name, timezone, greeting,
       provider_name, specialties, location, telehealth, insurance_accepted,
       hours_json, self_pay_rate_cents, emotional_support_enabled`
    )
    .eq('id', practiceId)
    .maybeSingle()

  if (!practice?.vapi_assistant_id) {
    console.warn(`[Vapi] Practice ${practiceId} has no vapi_assistant_id, using fallback`)
    return NextResponse.json({ assistant: buildFallbackAssistant() })
  }

  console.log(`[Vapi] Matched practice: ${practice.name} (${practiceId}) via ${resolvedBy} -> assistant ${practice.vapi_assistant_id}`)

  const practiceTimezone = practice.timezone || 'America/Los_Angeles'
  const callerContext = customerPhone
    ? await lookupReturningCallerContext(practiceId, customerPhone, practiceTimezone)
    : null

  const aiName = practice.ai_name || 'Ellie'

  // Build fresh systemPrompt + firstMessage on EVERY inbound call from current
  // DB state. Any edit to ai_name, greeting, hours, therapists, specialties,
  // etc. takes effect on the next call without a Vapi assistant PATCH. The
  // stored Vapi assistant still owns voice/model/server config; we only
  // override the per-call content.
  let freshSystemPrompt: string | null = null
  let freshFirstMessage: string | null = null
  try {
    const { data: therapistRows } = await supabaseAdmin
      .from('therapists')
      .select('display_name, credentials, bio, is_primary, is_active')
      .eq('practice_id', practiceId)
      .eq('is_active', true)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })

    freshSystemPrompt = buildSystemPrompt({
      therapist_name: practice.provider_name || aiName,
      practice_name: practice.name || practiceName,
      ai_name: aiName,
      specialties: practice.specialties || undefined,
      hours: formatHoursForPrompt(practice.hours_json),
      location: practice.location || undefined,
      telehealth: practice.telehealth ?? undefined,
      insurance_accepted: practice.insurance_accepted || undefined,
      emotional_support_enabled: practice.emotional_support_enabled ?? true,
      self_pay_rate_cents: practice.self_pay_rate_cents ?? null,
      therapists: (therapistRows || []).map((t: any) => ({
        display_name: t.display_name,
        credentials: t.credentials,
        bio: t.bio,
      })),
    })

    freshFirstMessage = buildFirstMessage(
      practice.greeting,
      aiName,
      practice.name || practiceName
    )
  } catch (err: any) {
    console.error('[Vapi] Failed to build fresh assistant overrides:', err?.message || err)
  }

  const baseOverrides: any = {}
  if (freshFirstMessage) baseOverrides.firstMessage = freshFirstMessage
  // NOTE: we used to override model.messages here to always ship the freshest
  // system prompt, but Vapi rejects a partial model object (requires provider
  // + model fields) and returns "couldn't get assistant" / voice-id-not-set
  // errors. System prompt still syncs to the stored assistant via the
  // /api/practices/[id] PATCH route on settings save, so this is a no-op
  // downside for ai_name / hours / specialties / greeting edits - but the
  // FRESHLY-RENDERED firstMessage override above IS enough to make ai_name
  // changes take effect on the next call without re-saving settings.
  // If we want live system-prompt-per-call in future, include full model config
  // (provider, model, temperature, messages) - not just messages.
  void freshSystemPrompt

  if (callerContext) {
    const firstName = (callerContext.first_name || '').trim()
    const lastName = (callerContext.last_name || '').trim()
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()
    console.log(`[Vapi] Returning caller (not disclosed in greeting for HIPAA): ${fullName || '(unknown name)'} | billing_mode=${callerContext.billing_mode}`)

    return NextResponse.json({
      assistantId: practice.vapi_assistant_id,
      assistantOverrides: {
        ...baseOverrides,
        variableValues: {
          caller_is_existing_patient: 'yes',
          caller_first_name: firstName,
          caller_last_name: lastName,
          caller_full_name: fullName,
          caller_billing_mode: callerContext.billing_mode || 'pending',
          caller_intake_completed: callerContext.intake_completed ? 'yes' : 'no',
          caller_last_appointment_at: callerContext.last_appointment_at || '',
          caller_last_appointment_status: callerContext.last_appointment_status || '',
          caller_next_appointment_at: callerContext.next_appointment_at || '',
          caller_next_appointment_status: callerContext.next_appointment_status || '',
          caller_insurance_provider: callerContext.insurance_provider || '',
        },
      },
    })
  }

  return NextResponse.json({
    assistantId: practice.vapi_assistant_id,
    assistantOverrides: {
      ...baseOverrides,
      variableValues: { caller_is_existing_patient: 'no' },
    },
  })
}

/**
 * Render hours_json as the string shape buildSystemPrompt expects. Mirrors
 * the helper in app/api/practices/[id]/route.ts so webhook-built prompts
 * match dashboard-built ones exactly.
 */
function formatHoursForPrompt(hoursJson: any): string {
  if (!hoursJson) return 'Monday through Friday, 9am to 5pm'
  if (typeof hoursJson === 'string') return hoursJson
  const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  const dayLabel: Record<string, string> = {
    monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
    thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
  }
  const parts: string[] = []
  for (const day of dayOrder) {
    const h = hoursJson[day]
    if (!h) continue
    if (typeof h === 'object' && 'enabled' in h) {
      if (h.enabled && h.openTime && h.closeTime) {
        parts.push(`${dayLabel[day]}: ${formatTimeClock(h.openTime)} - ${formatTimeClock(h.closeTime)}`)
      }
    } else if (typeof h === 'string' && h !== 'closed') {
      parts.push(`${dayLabel[day]}: ${h}`)
    }
  }
  return parts.length > 0 ? parts.join(', ') : 'Monday through Friday, 9am to 5pm'
}

function formatTimeClock(t: string): string {
  const [hh, mm] = t.split(':').map(Number)
  if (isNaN(hh)) return t
  const suffix = hh >= 12 ? 'PM' : 'AM'
  const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh
  return mm === 0 ? `${h12} ${suffix}` : `${h12}:${String(mm).padStart(2, '0')} ${suffix}`
}

/**
 * Pick the firstMessage for an inbound call. If the stored greeting already
 * references the current ai_name, use it verbatim (user curated). Otherwise
 * build a clean template from current ai_name so renaming the AI in settings
 * takes effect on the very next call (fixes 4/19/26 "I renamed Ellie but she
 * still says I'm Jeff" bug).
 */
function buildFirstMessage(
  storedGreeting: string | null | undefined,
  aiName: string,
  practiceName: string
): string {
  const defaultTemplate = `Thanks for calling ${practiceName}. This is ${aiName} - how can I help you today?`
  if (!storedGreeting || !storedGreeting.trim()) return defaultTemplate
  const g = storedGreeting.trim()
  const lowerGreeting = g.toLowerCase()
  const lowerName = aiName.toLowerCase()
  if (lowerName && lowerGreeting.includes(lowerName)) return g
  console.log(`[Vapi] Stored greeting does not reference ai_name="${aiName}" - using fresh template instead`)
  return defaultTemplate
}

/**
 * Look up a returning caller in this practice by phone. Returns null if no
 * match. Phone matching is tolerant: exact, normalized digits, and
 * trailing-10-digit match.
 */
async function lookupReturningCallerContext(
  practiceId: string,
  phone: string,
  timezone: string = 'America/Los_Angeles'
): Promise<null | {
  patient_id: string
  first_name: string | null
  last_name: string | null
  billing_mode: string | null
  intake_completed: boolean
  insurance_provider: string | null
  last_appointment_at: string | null
  last_appointment_status: string | null
  next_appointment_at: string | null
  next_appointment_status: string | null
}> {
  if (!phone) return null

  const digits = phone.replace(/\D/g, '')
  if (digits.length < 7) return null
  const last10 = digits.slice(-10)

  const { data: patients } = await supabaseAdmin
    .from('patients')
    .select('id, first_name, last_name, phone, billing_mode, intake_completed, insurance_provider')
    .eq('practice_id', practiceId)
    .limit(1000)

  const match = (patients || []).find((p: any) => {
    if (!p.phone) return false
    if (p.phone === phone) return true
    const pDigits = String(p.phone).replace(/\D/g, '')
    if (pDigits === digits) return true
    if (pDigits.length >= 10 && pDigits.slice(-10) === last10) return true
    return false
  })

  if (!match) return null

  const nowIso = new Date().toISOString()

  const { data: lastPast } = await supabaseAdmin
    .from('appointments')
    .select('scheduled_at, status')
    .eq('practice_id', practiceId)
    .eq('patient_id', match.id)
    .lt('scheduled_at', nowIso)
    .neq('status', 'cancelled')
    .order('scheduled_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: nextUpcoming } = await supabaseAdmin
    .from('appointments')
    .select('scheduled_at, status')
    .eq('practice_id', practiceId)
    .eq('patient_id', match.id)
    .gte('scheduled_at', nowIso)
    .neq('status', 'cancelled')
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return {
    patient_id: match.id,
    first_name: match.first_name,
    last_name: match.last_name,
    billing_mode: match.billing_mode || 'pending',
    intake_completed: !!match.intake_completed,
    insurance_provider: match.insurance_provider || null,
    last_appointment_at: formatAppointmentForSpeech(lastPast?.scheduled_at, timezone),
    last_appointment_status: lastPast?.status || null,
    next_appointment_at: formatAppointmentForSpeech(nextUpcoming?.scheduled_at, timezone),
    next_appointment_status: nextUpcoming?.status || null,
  }
}

function formatAppointmentForSpeech(
  iso: string | null | undefined,
  timezone: string
): string | null {
  if (!iso) return null
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return null
    const dateStr = d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: timezone,
    })
    const timeStr = d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
      timeZoneName: 'short',
    })
    return `${dateStr} at ${timeStr}`
  } catch {
    return iso
  }
}

// ---- tool-calls (new Vapi format) ----
async function handleToolCalls(message: any) {
  const toolCallList = message.toolWithToolCallList || []
  const call = message.call || {}

  // Resolve practice using shared fallback chain
  const { practiceId, resolvedBy } = await resolvePracticeId(call, message)
  if (resolvedBy !== 'none') {
    console.log(`[Vapi] Tool calls resolved practice via ${resolvedBy}`)
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
        case 'bookAppointment':
          result = await handleBookAppointment(params, practiceId, call?.id || null)
          break
        case 'takeMessage':
          result = await handleTakeMessage(params, practiceId)
          break
        case 'submitIntakeScreening':
          result = await handleSubmitScreening(params, practiceId)
          break
        case 'verifyIdentity':
          result = await handleVerifyIdentity(params, practiceId)
          break
        case 'cancelAppointment':
          result = await handleCancelAppointment(params, practiceId)
          break
        case 'rescheduleAppointment':
          result = await handleRescheduleAppointment(params, practiceId, call?.id || null)
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

  // Resolve practice using shared fallback chain
  const { practiceId, resolvedBy } = await resolvePracticeId(call, message)
  if (resolvedBy !== 'none') {
    console.log(`[Vapi] Function call resolved practice via ${resolvedBy}`)
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
      case 'bookAppointment':
        result = await handleBookAppointment(params, practiceId, call?.id || null)
        break
      case 'takeMessage':
        result = await handleTakeMessage(params, practiceId)
        break
      case 'submitIntakeScreening':
        result = await handleSubmitScreening(params, practiceId)
        break
      case 'verifyIdentity':
        result = await handleVerifyIdentity(params, practiceId)
        break
      case 'cancelAppointment':
        result = await handleCancelAppointment(params, practiceId)
        break
      case 'rescheduleAppointment':
        result = await handleRescheduleAppointment(params, practiceId, call?.id || null)
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
  // Diagnostic: log the top-level payload structure
  console.log(`[Vapi] end-of-call-report keys: ${Object.keys(message).join(', ')}`)
  if (message.call) console.log(`[Vapi] message.call keys: ${Object.keys(message.call).join(', ')}`)
  if (message.artifact) console.log(`[Vapi] message.artifact keys: ${Object.keys(message.artifact).join(', ')}`)

  const call = message.call || {}
  const artifact = message.artifact || {}
  const transcript = artifact.transcript || ''
  const messages = artifact.messages || []
  const vapiCallId = call.id || message.callId || ''
  const endedReason = message.endedReason || call.endedReason || 'unknown'
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
  const customerPhone = call.customer?.number || message.customer?.number || ''

  console.log(`[Vapi] Call ended: ${vapiCallId} | reason: ${endedReason} | duration: ${duration}s | caller: ${customerPhone || '(unknown)'}`)

  // Resolve practice using shared fallback chain
  const { practiceId, practiceName, resolvedBy } = await resolvePracticeId(call, message)
  if (!practiceId) {
    console.error('[Vapi] end-of-call-report: practice resolution FAILED — call log will not be created', { vapiCallId })
    return NextResponse.json({ ok: true })
  }
  console.log(`[Vapi] end-of-call-report resolved practice: ${practiceName} (${practiceId}) via ${resolvedBy}`)

  // Build transcript text from messages if not provided directly
  const transcriptText = transcript || messages
    .filter((m: any) => m.role !== 'system')
    .map((m: any) => `${(m.role === 'assistant' || m.role === 'bot') ? 'AI' : 'Caller'}: ${m.message || m.content || ''}`)
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

  // 3. Analyze transcript for Tier 1 data moat metrics
  let metrics: ReturnType<typeof analyzeTranscript> | null = null
  try {
    metrics = analyzeTranscript(transcriptText)
    console.log(`[Vapi] Transcript metrics: outcome=${metrics.callOutcome}, turns=${metrics.turnCount}, topics=[${metrics.topicsDiscussed.join(',')}], booking=${metrics.bookingAttempted}/${metrics.bookingSucceeded}`)
  } catch (metricsErr: any) {
    console.error('[Vapi] Transcript analysis failed (non-blocking):', metricsErr?.message)
  }

  // 4. Save call log to Supabase
  // FIX: Check Supabase {error} return instead of relying on try/catch
  // (Supabase JS v2 does NOT throw on errors â it returns {data, error})
  const callLogData: Record<string, any> = {
    practice_id: practiceId,
    vapi_call_id: vapiCallId || null,
    patient_phone: customerPhone || 'unknown',
    duration_seconds: Math.round(duration),
    transcript: transcriptText,
    summary: callSummary,
    ended_reason: endedReason,
    crisis_detected: crisisDetected,
    created_at: new Date().toISOString(),
  }

  // Tier 1 data moat: attach transcript metrics to call log
  if (metrics) {
    callLogData.call_outcome = metrics.callOutcome
    callLogData.is_new_patient = metrics.isNewPatient
    callLogData.booking_attempted = metrics.bookingAttempted
    // Authoritative booking_succeeded: only true if an appointment row was
    // actually created for this call. Prevents Ellie's confirmation language
    // from setting booking_succeeded=true when the DB insert silently failed
    // (the calendar_event_id bug we hit on 2026-04-20 was a known example).
    let bookingDbSucceeded = false
    if (vapiCallId) {
      const { data: bookedRow } = await supabaseAdmin
        .from('appointments')
        .select('id')
        .eq('vapi_call_id', vapiCallId)
        .limit(1)
        .maybeSingle()
      bookingDbSucceeded = !!bookedRow
    }
    callLogData.booking_succeeded = metrics.bookingAttempted ? bookingDbSucceeded : false
    callLogData.topics_discussed = metrics.topicsDiscussed
    callLogData.caller_talk_seconds = metrics.callerTalkSeconds
    callLogData.ai_talk_seconds = metrics.aiTalkSeconds
    callLogData.turn_count = metrics.turnCount
    callLogData.enriched_at = new Date().toISOString()
  }

  const { error: callLogError } = await supabaseAdmin.from('call_logs').upsert(
    callLogData,
    { onConflict: 'vapi_call_id' }
  )

  if (callLogError) {
    console.error('[Vapi] Failed to upsert call log:', callLogError.message, callLogError.details)
    // Fallback: try plain insert (in case upsert conflict on empty/null vapi_call_id)
    const { error: insertError } = await supabaseAdmin.from('call_logs').insert(callLogData)
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
    // Backfill any missing fields from this call (e.g. email collected for first time)
    const backfill: Record<string, any> = {}
    if (info.patientEmail) backfill.email = info.patientEmail
    if (info.patientInsurance) {
      backfill.insurance = info.patientInsurance
      backfill.insurance_provider = info.patientInsurance
    }
    if (info.reasonForSeeking) backfill.reason_for_seeking = info.reasonForSeeking
    if (Object.keys(backfill).length > 0) {
      backfill.updated_at = new Date().toISOString()
      await supabaseAdmin
        .from('patients')
        .update(backfill)
        .eq('id', existingPatient.id)
      console.log(`[Vapi] Backfilled patient ${existingPatient.id}:`, Object.keys(backfill).join(', '))
    }
  } else {
    // FIX: Create patient even with minimal info (phone number only)
    // Previously required a name from extraction â now uses "New Caller" as fallback
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
          insurance_provider: info.patientInsurance || null,
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
      console.log('[Vapi] No patient info available (no phone, email, or name) â skipping patient creation')
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

  // 4c. Tier 1 data moat: update patient aggregate counters
  if (resolvedPatientId) {
    try {
      const now = new Date().toISOString()
      const patientUpdate: Record<string, any> = {
        last_call_at: now,
        updated_at: now,
      }
      // For new patients, set first_contact_at and acquisition_source
      if (newPatient) {
        patientUpdate.first_contact_at = now
        patientUpdate.acquisition_source = 'ai_call'
        patientUpdate.total_calls = 1
      }
      // For existing patients, increment total_calls using raw SQL-like approach
      // (Supabase JS doesn't support atomic increment, so we fetch + update)
      if (existingPatient) {
        const { data: currentPatient } = await supabaseAdmin
          .from('patients')
          .select('total_calls')
          .eq('id', resolvedPatientId)
          .maybeSingle()
        patientUpdate.total_calls = (currentPatient?.total_calls || 0) + 1
      }

      await supabaseAdmin
        .from('patients')
        .update(patientUpdate)
        .eq('id', resolvedPatientId)
      console.log(`[Vapi] Patient counters updated: ${resolvedPatientId} (total_calls=${patientUpdate.total_calls})`)
    } catch (counterErr: any) {
      console.error('[Vapi] Patient counter update failed (non-blocking):', counterErr?.message)
    }
  }

  // 4d. Tier 2B: Log this call to patient_communications
  logCommunication({
    practiceId,
    patientId: resolvedPatientId || null,
    patientPhone: customerPhone || null,
    channel: 'call',
    direction: 'inbound',
    contentSummary: callSummary?.slice(0, 500) || null,
    durationSeconds: Math.round(duration) || null,
    metadata: {
      vapi_call_id: vapiCallId,
      call_outcome: metrics?.callOutcome || null,
      is_new_patient: metrics?.isNewPatient ?? null,
      ended_reason: endedReason,
    },
  })

  // 5. Crisis alert â save and SMS the therapist
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

  // 7. Auto-send intake forms when we captured *any* contact method.
  // Previously this required a phone number AND that the patient be new,
  // which silently dropped email-only captures and any returning caller who
  // hadn't been sent an intake yet. We now fire whenever we have at least
  // one reachable channel and a patient record (new or existing).
  const intakePatientId = newPatient?.id || existingPatient?.id || null
  if (intakePatientId && (patientPhone || info.patientEmail)) {
    try {
      // Get the call_log record to pass the ID
      const { data: callLogRecord } = await supabaseAdmin
        .from('call_logs')
        .select('id')
        .eq('vapi_call_id', vapiCallId)
        .single()

      // Pick the widest delivery that matches the contact info we have.
      const deliveryMethod: 'sms' | 'email' | 'both' =
        patientPhone && info.patientEmail
          ? 'both'
          : info.patientEmail
            ? 'email'
            : 'sms'

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
      const intakePayload = {
        practice_id: practiceId,
        patient_id: intakePatientId,
        call_log_id: callLogRecord?.id || null,
        patient_phone: patientPhone || null,
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
      const parsedDate = parseAppointmentDate(info.appointmentTime)
      const durationMinutes = 60

      // 8a. Push to the practice's connected calendar first, so we can store
      // the event id on the appointment row. If no calendar is connected, or
      // the push fails, we still save the DB row so the booking is not lost.
      let calendarEventId: string | null = null
      if (parsedDate) {
        try {
          const router = await withTimeout(
            getCalendarRouter(practiceId),
            5000,
            'getCalendarRouter'
          )
          if (router) {
            const endDate = new Date(parsedDate.getTime() + durationMinutes * 60_000)
            const summary = `Therapy: ${info.patientName || 'New patient'}`
            const description = [
              `Booked via phone (${practiceName}).`,
              info.patientPhone ? `Phone: ${info.patientPhone}` : null,
              info.patientEmail ? `Email: ${info.patientEmail}` : null,
              info.reasonForSeeking ? `Reason: ${info.reasonForSeeking}` : null,
            ]
              .filter(Boolean)
              .join('\n')
            const ev = await withTimeout(
              router.createEvent({
                summary,
                start: parsedDate,
                end: endDate,
                description,
              }),
              6000,
              'router.createEvent'
            )
            calendarEventId = ev.id
            console.log(`[Vapi] Calendar event created (${router.provider}): ${calendarEventId}`)
          } else {
            console.log('[Vapi] No calendar connection for practice — skipping calendar push')
          }
        } catch (calErr: any) {
          console.error('[Vapi] Calendar push failed (non-blocking):', calErr?.message || calErr)
        }
      } else {
        console.log('[Vapi] Could not parse appointmentTime — skipping calendar push')
      }

      const appointmentData: any = {
        practice_id: practiceId,
        patient_id: appointmentPatientId || null,
        patient_name: info.patientName || null,
        patient_phone: patientPhone || null,
        patient_email: info.patientEmail || null,
        appointment_time: info.appointmentTime,
        status: 'scheduled',
        source: 'ai_call',
        duration_minutes: durationMinutes,
        calendar_event_id: calendarEventId,
      }

      // Tier 1: booking lead time (hours between now and appointment)
      if (parsedDate) {
        const leadTimeMs = parsedDate.getTime() - Date.now()
        appointmentData.booking_lead_time_hours = Math.max(0, Math.round(leadTimeMs / (1000 * 60 * 60)))
      }

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
        console.log(`[Vapi] Appointment created: ${info.appointmentTime} for ${info.patientName || patientPhone} (calendar_event_id=${calendarEventId || 'none'})`)
      }
    } catch (err) {
      console.error('[Vapi] Appointment creation error:', err)
    }
  }
}

// ---- Tool handlers ----

async function handleCollectIntake(params: any, practiceId: string | null): Promise<string> {
  const { name, phone, email, insurance, telehealthPreference, reason, preferredTimes } = params

  if (!practiceId) {
    return 'Intake information has been recorded. Now let me check the calendar for available appointment times.'
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
      if (email) updates.email = email
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
          email: email || null,
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

  return 'Intake information has been recorded. Now let me check the calendar for available appointment times.'
}

async function handleCheckAvailability(params: any, practiceId: string | null): Promise<string> {
  const { preferredDay, preferredTime } = params

  if (!practiceId) {
    return 'I was not able to look up the calendar right now. Let me take down your preferred times and the office will confirm shortly.'
  }

  try {
    const router = await getCalendarRouter(practiceId)
    if (!router) {
      return 'The calendar is not connected for this practice yet. Let me take down your preferred times and someone will confirm your appointment.'
    }

    // Build a search window based on the preferred day
    const now = new Date()
    let searchStart = new Date(now)
    let searchEnd = new Date(now)

    // Try to parse the preferred day into an actual date range
    const dayLower = (preferredDay || '').toLowerCase()
    const dayMap: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    }

    if (dayLower === 'today') {
      searchStart = new Date(now)
      searchEnd = new Date(now)
      searchEnd.setHours(23, 59, 59)
    } else if (dayLower === 'tomorrow') {
      searchStart = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      searchStart.setHours(0, 0, 0)
      searchEnd = new Date(searchStart)
      searchEnd.setHours(23, 59, 59)
    } else if (dayMap[dayLower] !== undefined) {
      const targetDay = dayMap[dayLower]
      const currentDay = now.getDay()
      let daysAhead = targetDay - currentDay
      if (daysAhead <= 0) daysAhead += 7
      searchStart = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000)
      searchStart.setHours(0, 0, 0)
      searchEnd = new Date(searchStart)
      searchEnd.setHours(23, 59, 59)
    } else {
      // No specific day — search the next 7 days
      searchEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    }

    // Determine business hours filter from preferred time
    let businessHours = { startHour: 9, endHour: 17 }
    const timeLower = (preferredTime || '').toLowerCase()
    if (timeLower.includes('morning')) {
      businessHours = { startHour: 9, endHour: 12 }
    } else if (timeLower.includes('afternoon')) {
      businessHours = { startHour: 12, endHour: 17 }
    } else if (timeLower.includes('evening')) {
      businessHours = { startHour: 16, endHour: 20 }
    }

    const events = await withTimeout(
      router.listEvents(searchStart, searchEnd),
      6000,
      'router.listEvents'
    )
    const slots = findFreeSlots(events, searchStart, searchEnd, 60, businessHours)

    if (slots.length === 0) {
      const dayLabel = dayLower || 'that time frame'
      return `I checked the calendar and unfortunately there are no open slots ${dayLabel}${preferredTime ? ` in the ${preferredTime}` : ''}. Would you like me to check a different day or time?`
    }

    // Format up to 3 slots for the caller
    const formatted = slots.slice(0, 3).map((s) => {
      return s.start.toLocaleString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    })

    if (formatted.length === 1) {
      return `I have an opening on ${formatted[0]}. Would that work for you?`
    }
    const last = formatted.pop()
    return `I have a few openings: ${formatted.join(', ')}, and ${last}. Which of those works best for you?`
  } catch (err: any) {
    console.error('[Vapi] checkAvailability error:', err?.message || err)
    return 'I had a little trouble checking the calendar just now. Let me take down your preferred times and we will confirm your appointment shortly.'
  }
}

async function handleBookAppointment(params: any, practiceId: string | null, vapiCallId: string | null = null): Promise<string> {
  const { patientName, appointmentDateTime, patientPhone, patientEmail, reason } = params

  if (!practiceId) {
    return 'I was unable to book the appointment right now. The office will follow up to confirm your time.'
  }

  try {
    // Parse the appointment date/time
    const parsedDate = parseAppointmentDate(appointmentDateTime)
    if (!parsedDate) {
      return `I could not understand the date "${appointmentDateTime}". Could you tell me the day and time again?`
    }

    const durationMinutes = 60
    const endDate = new Date(parsedDate.getTime() + durationMinutes * 60_000)

    // Get practice name for the calendar event
    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('name, provider_name')
      .eq('id', practiceId)
      .maybeSingle()

    const practiceName = practice?.name || 'the practice'

    // Push to the practice's connected calendar
    let calendarEventId: string | null = null
    try {
      const router = await withTimeout(
        getCalendarRouter(practiceId),
        5000,
        'getCalendarRouter'
      )
      if (router) {
        const summary = `Therapy: ${patientName || 'New patient'}`
        const description = [
          `Booked via phone (${practiceName}).`,
          patientPhone ? `Phone: ${patientPhone}` : null,
          patientEmail ? `Email: ${patientEmail}` : null,
          reason ? `Reason: ${reason}` : null,
        ].filter(Boolean).join('\n')

        const ev = await withTimeout(
          router.createEvent({
            summary,
            start: parsedDate,
            end: endDate,
            description,
          }),
          6000,
          'router.createEvent'
        )
        calendarEventId = ev.id
        console.log(`[Vapi] bookAppointment: calendar event created (${router.provider}): ${calendarEventId}`)
      } else {
        console.log('[Vapi] bookAppointment: no calendar connection — saving DB record only')
      }
    } catch (calErr: any) {
      console.error('[Vapi] bookAppointment: calendar push failed:', calErr?.message || calErr)
    }

    // Save appointment to DB
    const leadTimeMs = parsedDate.getTime() - Date.now()
    const appointmentData: any = {
      practice_id: practiceId,
      patient_name: patientName || null,
      patient_phone: patientPhone || null,
      patient_email: patientEmail || null,
      appointment_time: appointmentDateTime,
      scheduled_at: parsedDate.toISOString(),
      appointment_date: parsedDate.toISOString().split('T')[0],
      status: 'scheduled',
      source: 'ai_call',
      duration_minutes: durationMinutes,
      calendar_event_id: calendarEventId,
      booking_lead_time_hours: Math.max(0, Math.round(leadTimeMs / (1000 * 60 * 60))),
      vapi_call_id: vapiCallId,
    }

    // Try to link to existing patient
    if (patientPhone) {
      const normalizedPhone = patientPhone.replace(/\D/g, '').slice(-10)
      if (normalizedPhone.length >= 10) {
        const { data: existing } = await supabaseAdmin
          .from('patients')
          .select('id')
          .eq('practice_id', practiceId)
          .ilike('phone', `%${normalizedPhone}`)
          .limit(1)
          .maybeSingle()
        if (existing) appointmentData.patient_id = existing.id
      }
    }

    const { error: apptError } = await supabaseAdmin
      .from('appointments')
      .insert(appointmentData)

    if (apptError) {
      console.error('[Vapi] bookAppointment: DB insert failed:', apptError.message)
      return 'I had trouble saving that appointment. Let me take a note and the office will confirm your booking.'
    }

    // Format confirmation
    const confirmTime = parsedDate.toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })

    console.log(`[Vapi] bookAppointment: confirmed ${confirmTime} for ${patientName || patientPhone}`)
    return `Your appointment is confirmed for ${confirmTime}. ${calendarEventId ? 'It has been added to the calendar.' : ''} Is there anything else I can help you with?`
  } catch (err: any) {
    console.error('[Vapi] bookAppointment error:', err?.message || err)
    return 'I had trouble booking that appointment. Let me take a note and the office will confirm your time.'
  }
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

      // Tier 2A: Also write to patient_assessments for longitudinal tracking
      await supabaseAdmin.from('patient_assessments').insert({
        practice_id: practiceId,
        patient_id: patientId,
        patient_name: patientName || null,
        assessment_type: 'phq2_gad2_phone',
        score: totalScore,
        severity: severity,
        responses_json: { phq2: parseInt(phq2Score) || 0, gad2: parseInt(gad2Score) || 0 },
        administered_by: 'ai_call',
        completed_at: new Date().toISOString(),
      }).then(({ error }) => {
        if (error) console.error('[Vapi] patient_assessments insert error:', error.message)
        else console.log(`[Vapi] patient_assessments: PHQ-2/GAD-2 logged for ${patientId || patientName}`)
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
            email: { type: 'string', description: 'Patient email address' },
            insurance: { type: 'string', description: 'Insurance provider or self-pay' },
            telehealthPreference: { type: 'string', description: 'telehealth or in-person' },
            reason: { type: 'string', description: 'Brief reason for seeking therapy' },
            preferredTimes: { type: 'string', description: 'Preferred days and times' },
          },
          required: ['name', 'phone', 'email'],
        },
      },
      async: false,
      server: { url: serverUrl },
    },
    {
      type: 'function',
      function: {
        name: 'checkAvailability',
        description: 'Check the practice calendar for available appointment slots on a given day and time. Returns real open time slots.',
        parameters: {
          type: 'object',
          properties: {
            preferredDay: { type: 'string', description: 'Day to check — e.g. "Monday", "tomorrow", "today", or a date like "April 20"' },
            preferredTime: { type: 'string', description: 'Time preference: "morning", "afternoon", "evening", or a specific time like "2pm"' },
          },
        },
      },
      async: false,
      server: { url: serverUrl },
    },
    {
      type: 'function',
      function: {
        name: 'bookAppointment',
        description: 'Book a confirmed appointment on the practice calendar. Use this after the caller has chosen a specific date and time.',
        parameters: {
          type: 'object',
          properties: {
            patientName: { type: 'string', description: 'Full name of the patient' },
            appointmentDateTime: { type: 'string', description: 'The chosen appointment date and time, e.g. "Monday April 21 at 2pm" or "2026-04-21T14:00:00"' },
            patientPhone: { type: 'string', description: 'Patient phone number' },
            patientEmail: { type: 'string', description: 'Patient email address' },
            reason: { type: 'string', description: 'Brief reason for the appointment' },
          },
          required: ['patientName', 'appointmentDateTime'],
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
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      messages: [
        {
          role: 'system',
          content: 'You are a friendly receptionist for a therapy practice. Help callers with basic questions and offer to take a message. If someone is in crisis, direct them to call 988 or 911.',
        },
      ],
      temperature: 0.7,
    },
    voice: {
      provider: '11labs',
      voiceId: 'EXAVITQu4vr4xnSDxMaL',
      model: 'eleven_turbo_v2_5',
      stability: 0.5,
      similarityBoost: 0.8,
      speed: 0.85,
      style: 0.2,
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
    const dayLabels: Record<string, string> = {
      monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
      thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
    }
    const parts: string[] = []
    for (const day of days) {
      const h = hoursJson[day]
      if (!h) continue
      // Handle structured format: { enabled, openTime, closeTime }
      if (typeof h === 'object' && 'enabled' in h) {
        if (h.enabled && h.openTime && h.closeTime) {
          parts.push(`${dayLabels[day]}: ${fmtTime(h.openTime)} - ${fmtTime(h.closeTime)}`)
        }
      } else if (typeof h === 'string' && h !== 'closed') {
        parts.push(`${dayLabels[day]}: ${h}`)
      }
    }
    return parts.length > 0 ? parts.join(', ') : 'Monday through Friday, 9am to 5pm'
  } catch {
    return 'Monday through Friday, 9am to 5pm'
  }
}

function fmtTime(t: string): string {
  const [hh, mm] = t.split(':').map(Number)
  if (isNaN(hh)) return t
  const suffix = hh >= 12 ? 'PM' : 'AM'
  const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh
  return mm === 0 ? `${h12} ${suffix}` : `${h12}:${mm.toString().padStart(2, '0')} ${suffix}`
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


// ============================================================================
// HIPAA identity verification (added 4/20/26)
// ----------------------------------------------------------------------------
// Ellie must call verifyIdentity with first name + last name + date of birth
// BEFORE disclosing any PHI. If any field mismatches what's on file, the tool
// returns verified: false and Ellie must refuse disclosure.
// ============================================================================

/**
 * Normalize a date-of-birth string the caller speaks into ISO yyyy-mm-dd so
 * we can compare against patients.date_of_birth (stored as text like
 * '1990-11-07'). Accepts a few spoken/written shapes:
 *   "November 7, 1990", "11/07/1990", "11-7-1990", "1990-11-07"
 * Returns null if unparseable.
 */
function normalizeDOB(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  // Already ISO
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (iso) {
    const y = iso[1]
    const m = String(iso[2]).padStart(2, '0')
    const d = String(iso[3]).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  // mm/dd/yyyy or m-d-yyyy
  const mdy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(s)
  if (mdy) {
    const m = String(mdy[1]).padStart(2, '0')
    const d = String(mdy[2]).padStart(2, '0')
    return `${mdy[3]}-${m}-${d}`
  }
  // Try Date parsing as a last resort ("November 7, 1990" etc.)
  const parsed = new Date(s)
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getUTCFullYear()
    const m = String(parsed.getUTCMonth() + 1).padStart(2, '0')
    const d = String(parsed.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return null
}

function normalizeName(s: string | null | undefined): string {
  return (s || '').toLowerCase().replace(/[^a-z]/g, '').trim()
}

/**
 * verifyIdentity tool: HIPAA gate. Matches caller's stated {firstName,
 * lastName, dateOfBirth} against patients table. Writes the verification
 * outcome to the call_logs row (once patched up by end-of-call report).
 *
 * Returns plain text for Ellie - success or failure, never mentioning the
 * on-file fields themselves.
 */
async function handleVerifyIdentity(
  params: any,
  practiceId: string | null
): Promise<string> {
  if (!practiceId) {
    return 'I was not able to verify that right now. Let me take a message for the team instead.'
  }
  const firstName = normalizeName(params?.firstName)
  const lastName = normalizeName(params?.lastName)
  const dobIso = normalizeDOB(params?.dateOfBirth)

  if (!firstName || !lastName || !dobIso) {
    return 'VERIFICATION_INCOMPLETE: I still need the full first name, last name, and date of birth to verify.'
  }

  try {
    const { data: patients } = await supabaseAdmin
      .from('patients')
      .select('id, first_name, last_name, date_of_birth')
      .eq('practice_id', practiceId)
      .limit(2000)

    const match = (patients || []).find((p: any) => {
      if (!p.first_name || !p.last_name || !p.date_of_birth) return false
      if (normalizeName(p.first_name) !== firstName) return false
      if (normalizeName(p.last_name) !== lastName) return false
      const storedDOB = normalizeDOB(p.date_of_birth)
      return storedDOB === dobIso
    })

    if (!match) {
      console.log(`[Vapi] verifyIdentity FAIL for practice ${practiceId} - first=${firstName} last=${lastName} dob=${dobIso}`)
      return "VERIFICATION_FAILED: I wasn't able to find a record that matches. For your privacy, I can't share details without a match. I can take a message for the therapist instead."
    }

    console.log(`[Vapi] verifyIdentity OK for practice ${practiceId} - patient ${match.id}`)
    return `VERIFICATION_OK:${match.id}`
  } catch (err: any) {
    console.error('[Vapi] verifyIdentity error:', err?.message || err)
    return 'I was not able to verify that right now. Let me take a message so the team can follow up.'
  }
}

/**
 * cancelAppointment tool: requires prior VERIFICATION_OK. Takes the patient
 * id (from the verification step) and the appointment date/time to cancel.
 * Marks the DB row status=cancelled and deletes the Google Calendar event.
 */
async function handleCancelAppointment(
  params: any,
  practiceId: string | null
): Promise<string> {
  if (!practiceId) return 'I was not able to cancel that right now. Let me take a message for the team.'

  const patientId = params?.patientId
  const appointmentDateTime = params?.appointmentDateTime
  if (!patientId) return 'I need to verify your identity first before I can cancel an appointment.'
  if (!appointmentDateTime) return 'Which appointment would you like to cancel?'

  try {
    // Find the appointment. Match by patient_id + a fuzzy scheduled_at window.
    const parsed = parseAppointmentDate(appointmentDateTime)
    let query = supabaseAdmin
      .from('appointments')
      .select('id, scheduled_at, status, calendar_event_id')
      .eq('practice_id', practiceId)
      .eq('patient_id', patientId)
      .neq('status', 'cancelled')
      .order('scheduled_at', { ascending: true })
      .limit(10)

    const { data: candidates } = await query
    let target: any = null
    if (parsed && candidates && candidates.length > 0) {
      // Pick the candidate closest to parsed (within 2 hours)
      const parsedMs = parsed.getTime()
      target = candidates
        .map((c: any) => ({ c, d: Math.abs(new Date(c.scheduled_at).getTime() - parsedMs) }))
        .filter((x) => x.d < 2 * 60 * 60 * 1000)
        .sort((a, b) => a.d - b.d)[0]?.c
    }
    if (!target && candidates && candidates.length === 1) target = candidates[0]

    if (!target) {
      return "I couldn't find that appointment to cancel. Let me take a message so the team can help."
    }

    // Delete from Google calendar (non-fatal on fail)
    if (target.calendar_event_id) {
      try {
        const router = await withTimeout(getCalendarRouter(practiceId), 5000, 'getCalendarRouter')
        if (router) {
          await withTimeout(router.deleteEvent(target.calendar_event_id), 6000, 'router.deleteEvent')
          console.log(`[Vapi] cancelAppointment: Google event ${target.calendar_event_id} deleted`)
        }
      } catch (calErr: any) {
        console.error('[Vapi] cancelAppointment: calendar delete failed (non-blocking):', calErr?.message || calErr)
      }
    }

    // Mark DB row cancelled
    await supabaseAdmin
      .from('appointments')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', target.id)

    return `CANCEL_OK: Your appointment on ${new Date(target.scheduled_at).toLocaleString('en-US')} is cancelled. You'll get a confirmation by text shortly.`
  } catch (err: any) {
    console.error('[Vapi] cancelAppointment error:', err?.message || err)
    return 'I ran into trouble cancelling that. Let me take a message so the team can follow up.'
  }
}

/**
 * rescheduleAppointment tool: requires prior VERIFICATION_OK. Cancels the
 * existing appointment and books the new one. If the new booking fails, the
 * original is LEFT INTACT (we only cancel after the new event is confirmed)
 * so the patient never ends up with zero appointments due to partial failure.
 */
async function handleRescheduleAppointment(
  params: any,
  practiceId: string | null,
  vapiCallId: string | null = null
): Promise<string> {
  if (!practiceId) return 'I was not able to reschedule right now. Let me take a message for the team.'

  const patientId = params?.patientId
  const oldAppointmentDateTime = params?.oldAppointmentDateTime
  const newAppointmentDateTime = params?.newAppointmentDateTime
  if (!patientId) return 'I need to verify your identity first before I can reschedule.'
  if (!oldAppointmentDateTime || !newAppointmentDateTime) {
    return 'I need both the current appointment time and the new time you would like.'
  }

  try {
    // Look up patient's name/phone/email so bookAppointment can reuse them
    const { data: patient } = await supabaseAdmin
      .from('patients')
      .select('first_name, last_name, phone, email')
      .eq('id', patientId)
      .maybeSingle()
    const patientName = [patient?.first_name, patient?.last_name].filter(Boolean).join(' ').trim()

    // Book the NEW slot first (so a failure leaves the old slot untouched)
    const bookResult = await handleBookAppointment(
      {
        patientName: patientName || 'Returning patient',
        appointmentDateTime: newAppointmentDateTime,
        patientPhone: patient?.phone || '',
        patientEmail: patient?.email || '',
        reason: 'Rescheduled from a previous booking',
      },
      practiceId,
      vapiCallId
    )
    if (!bookResult.startsWith('BOOK_OK') && !bookResult.toLowerCase().includes('confirmed')) {
      // bookAppointment may not have a BOOK_OK prefix - detect failure loosely.
      if (bookResult.toLowerCase().includes('unable') || bookResult.toLowerCase().includes('trouble') || bookResult.toLowerCase().includes('not able')) {
        return `RESCHEDULE_FAILED: ${bookResult}`
      }
    }

    // Now cancel the old one
    const cancelResult = await handleCancelAppointment(
      { patientId, appointmentDateTime: oldAppointmentDateTime },
      practiceId
    )

    return `RESCHEDULE_OK: New appointment booked. ${cancelResult}`
  } catch (err: any) {
    console.error('[Vapi] rescheduleAppointment error:', err?.message || err)
    return 'I ran into trouble with the reschedule. Let me take a message so the team can follow up.'
  }
}
