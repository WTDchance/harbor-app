// Agentic SMS responder for Harbor.
// Uses Claude Sonnet 4.6 with tool-use to autonomously book / reschedule /
// cancel appointments and answer FAQ for each practice.
//
// Contract with caller (app/api/sms/inbound/route.ts):
//   runSmsAgent({ practice, patient, from, body, history }) -> finalReplyText
//
// The agent will:
//   - call tools against Supabase + the practice's calendar router
//   - keep looping until Claude stops requesting tools
//   - return plain text suitable for Twilio SMS (<=480 chars trimmed)
//
// Safety:
//   - STOP/HELP/crisis are handled UPSTREAM in the route. Agent is only
//     invoked for normal conversational traffic.
//   - Max 6 tool iterations to prevent runaway cost.

import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'
import { getCalendarRouter, findFreeSlots, NormalizedEvent } from '@/lib/calendar'

const apiKey = process.env.ANTHROPIC_API_KEY || ''
const client = apiKey ? new Anthropic({ apiKey }) : null

const MAX_TURNS = 6

export interface AgentContext {
  practice: any
  patient: any | null
  from: string
  body: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'check_availability',
    description:
      'Check the practice calendar for free appointment slots in a date range. Returns up to 6 candidate slots. Use this BEFORE booking.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'ISO date (YYYY-MM-DD) to start searching.' },
        end_date: { type: 'string', description: 'ISO date (YYYY-MM-DD) end of search window (inclusive).' },
        duration_minutes: { type: 'number', description: 'Session length in minutes (default 50).' },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'book_appointment',
    description:
      'Book an appointment on the practice calendar AND insert into the appointments table. Only call AFTER confirming the time with the patient.',
    input_schema: {
      type: 'object',
      properties: {
        start_iso: { type: 'string', description: 'ISO datetime for appointment start.' },
        duration_minutes: { type: 'number', description: 'Session length in minutes (default 50).' },
        patient_name: { type: 'string' },
        reason: { type: 'string', description: 'Reason for visit (e.g. intake, followup).' },
      },
      required: ['start_iso', 'patient_name'],
    },
  },
  {
    name: 'list_upcoming_appointments',
    description: 'List upcoming appointments for this patient (next 60 days).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'cancel_appointment',
    description: 'Cancel a specific appointment by its id (from list_upcoming_appointments).',
    input_schema: {
      type: 'object',
      properties: { appointment_id: { type: 'string' } },
      required: ['appointment_id'],
    },
  },
  {
    name: 'reschedule_appointment',
    description:
      'Reschedule an appointment. Internally cancels the old and books a new one at new_start_iso.',
    input_schema: {
      type: 'object',
      properties: {
        appointment_id: { type: 'string' },
        new_start_iso: { type: 'string' },
        duration_minutes: { type: 'number' },
      },
      required: ['appointment_id', 'new_start_iso'],
    },
  },
  {
    name: 'get_practice_info',
    description:
      'Get the practice name, address, phone, hours, and accepted insurance for Q&A.',
    input_schema: { type: 'object', properties: {} },
  },
]

function buildSystemPrompt(ctx: AgentContext): string {
  const p = ctx.practice
  const patientLine = ctx.patient
    ? `Known patient: ${ctx.patient.name || 'unknown'} (id ${ctx.patient.id}).`
    : `This sender has no patient record yet. If they want to book, collect their full name first.`
  const now = new Date().toISOString()
  return `You are ${p.ai_name || 'Sam'}, the AI receptionist for ${p.name}. You are texting a patient via SMS.

Current time (UTC): ${now}
Practice phone: ${p.phone_number}
${patientLine}

Your job:
- Book / reschedule / cancel therapy appointments using the provided tools.
- Answer basic questions about the practice (hours, location, insurance).
- Keep messages SHORT (under 320 characters, ideally 2-3 sentences).
- Never give clinical or medical advice. Never discuss symptoms, treatment plans, or medications.
- If someone sounds in crisis, reply that they should call or text 988 (this is rare; crisis is pre-filtered).
- Always confirm a specific time with the patient BEFORE calling book_appointment.
- After booking/canceling, confirm with the patient.
- Dates: interpret "tomorrow", "next Tuesday" etc. relative to the current time above, in US Pacific time.
- If the patient asks something you cannot handle, say you'll have a team member follow up.

Tone: warm, brief, professional. No emojis. No markdown.`
}

// ----- Tool executors -----

async function exec_check_availability(practiceId: string, args: any) {
  const router = await getCalendarRouter(practiceId)
  if (!router) {
    // Fallback: use appointments table only
    const start = new Date(args.start_date + 'T00:00:00Z')
    const end = new Date(args.end_date + 'T23:59:59Z')
    const { data: appts } = await supabaseAdmin
      .from('appointments')
      .select('appointment_date, appointment_time, duration_minutes')
      .eq('practice_id', practiceId)
      .gte('appointment_date', args.start_date)
      .lte('appointment_date', args.end_date)
      .neq('status', 'cancelled')
    const events: NormalizedEvent[] = (appts || []).map((a: any) => {
      const s = new Date(`${a.appointment_date}T${a.appointment_time}`)
      const e = new Date(s.getTime() + (a.duration_minutes || 50) * 60000)
      return { id: '', title: 'booked', start: s.toISOString(), end: e.toISOString(), provider: 'google' }
    })
    const slots = findFreeSlots(events, start, end, args.duration_minutes || 50, { startHour: 9, endHour: 17 })
    return { slots: slots.slice(0, 6).map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })), source: 'db-only' }
  }
  const start = new Date(args.start_date + 'T00:00:00Z')
  const end = new Date(args.end_date + 'T23:59:59Z')
  const events = await router.listEvents(start, end)
  const slots = findFreeSlots(events, start, end, args.duration_minutes || 50, { startHour: 9, endHour: 17 })
  return { slots: slots.slice(0, 6).map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })), source: router.provider }
}

async function exec_book_appointment(ctx: AgentContext, args: any) {
  const start = new Date(args.start_iso)
  const duration = args.duration_minutes || 50
  const end = new Date(start.getTime() + duration * 60000)

  // 1. Create calendar event (if connected)
  let calendarEventId: string | null = null
  const router = await getCalendarRouter(ctx.practice.id)
  if (router) {
    try {
      const ev = await router.createEvent({
        summary: `Therapy: ${args.patient_name}`,
        start,
        end,
        description: `Booked via SMS by ${ctx.from}. Reason: ${args.reason || 'n/a'}.`,
      })
      calendarEventId = ev.id
    } catch (err: any) {
      return { error: `Calendar booking failed: ${err.message}` }
    }
  }

  // 2. Ensure patient row
  let patientId = ctx.patient?.id
  if (!patientId) {
    const { data: newPatient } = await supabaseAdmin
      .from('patients')
      .insert({
        practice_id: ctx.practice.id,
        name: args.patient_name,
        phone: ctx.from,
      })
      .select()
      .single()
    patientId = newPatient?.id
  }

  // 3. Insert appointment row
  const apptDate = start.toISOString().split('T')[0]
  const apptTime = start.toISOString().split('T')[1].substring(0, 8)
  const { data: appt, error } = await supabaseAdmin
    .from('appointments')
    .insert({
      practice_id: ctx.practice.id,
      patient_id: patientId,
      appointment_date: apptDate,
      appointment_time: apptTime,
      duration_minutes: duration,
      status: 'scheduled',
      source: 'sms',
      calendar_event_id: calendarEventId,
      notes: args.reason || null,
    })
    .select()
    .single()

  if (error) return { error: error.message }
  return { ok: true, appointment_id: appt.id, when: start.toISOString() }
}

async function exec_list_upcoming(ctx: AgentContext) {
  if (!ctx.patient?.id) return { appointments: [] }
  const today = new Date().toISOString().split('T')[0]
  const { data } = await supabaseAdmin
    .from('appointments')
    .select('id, appointment_date, appointment_time, duration_minutes, status, calendar_event_id')
    .eq('practice_id', ctx.practice.id)
    .eq('patient_id', ctx.patient.id)
    .gte('appointment_date', today)
    .neq('status', 'cancelled')
    .order('appointment_date')
    .limit(10)
  return { appointments: data || [] }
}

async function exec_cancel(ctx: AgentContext, args: any) {
  const { data: appt } = await supabaseAdmin
    .from('appointments')
    .select('*')
    .eq('id', args.appointment_id)
    .eq('practice_id', ctx.practice.id)
    .single()
  if (!appt) return { error: 'Appointment not found' }

  // Delete from calendar
  if (appt.calendar_event_id) {
    const router = await getCalendarRouter(ctx.practice.id)
    if (router) {
      try { await router.deleteEvent(appt.calendar_event_id) } catch (e) { console.error('cal delete', e) }
    }
  }

  await supabaseAdmin
    .from('appointments')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', appt.id)

  return { ok: true }
}

async function exec_reschedule(ctx: AgentContext, args: any) {
  const cancelResult = await exec_cancel(ctx, { appointment_id: args.appointment_id })
  if ((cancelResult as any).error) return cancelResult
  // Use patient's name on the old appointment
  const name = ctx.patient?.name || 'Patient'
  return exec_book_appointment(ctx, {
    start_iso: args.new_start_iso,
    duration_minutes: args.duration_minutes || 50,
    patient_name: name,
    reason: 'rescheduled via SMS',
  })
}

async function exec_practice_info(ctx: AgentContext) {
  const p = ctx.practice
  return {
    name: p.name,
    phone: p.phone_number,
    address: p.address || null,
    hours: p.hours_json || null,
    insurance: p.insurance_accepted || [],
  }
}

async function runTool(name: string, args: any, ctx: AgentContext): Promise<any> {
  try {
    switch (name) {
      case 'check_availability': return await exec_check_availability(ctx.practice.id, args)
      case 'book_appointment': return await exec_book_appointment(ctx, args)
      case 'list_upcoming_appointments': return await exec_list_upcoming(ctx)
      case 'cancel_appointment': return await exec_cancel(ctx, args)
      case 'reschedule_appointment': return await exec_reschedule(ctx, args)
      case 'get_practice_info': return await exec_practice_info(ctx)
      default: return { error: `Unknown tool ${name}` }
    }
  } catch (err: any) {
    return { error: err.message || String(err) }
  }
}

/**
 * Run the agent against a single inbound SMS and return the reply text.
 */
export async function runSmsAgent(ctx: AgentContext): Promise<string> {
  if (!client) {
    return 'Thanks for your message! Our team will get back to you soon.'
  }

  const system = buildSystemPrompt(ctx)
  const messages: Anthropic.Messages.MessageParam[] = [
    ...ctx.history,
    { role: 'user', content: ctx.body },
  ]

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system,
      tools: TOOLS,
      messages,
    })

    if (response.stop_reason === 'tool_use') {
      // Execute tools
      const toolUses = response.content.filter((b) => b.type === 'tool_use') as Anthropic.Messages.ToolUseBlock[]
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []
      for (const tu of toolUses) {
        const result = await runTool(tu.name, tu.input, ctx)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result).slice(0, 4000),
        })
      }
      messages.push({ role: 'assistant', content: response.content })
      messages.push({ role: 'user', content: toolResults })
      continue
    }

    // Final text answer
    const textBlock = response.content.find((b) => b.type === 'text') as Anthropic.Messages.TextBlock | undefined
    let reply = textBlock?.text?.trim() || 'Thanks for your message! Our team will get back to you soon.'
    if (reply.length > 480) reply = reply.slice(0, 477) + '...'
    return reply
  }

  return 'Let me have a team member follow up with you shortly.'
}
