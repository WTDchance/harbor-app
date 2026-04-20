// FILE: app/api/admin/repair-practice/route.ts
// Admin-only: read or patch ANY field on a practice, including normally-
// protected infrastructure columns (phone_number, twilio_phone_sid,
// vapi_assistant_id, vapi_phone_number_id, etc.).
//
// This is the "break glass" endpoint — used when a practice row was
// mis-created and needs surgical correction before re-provisioning Vapi.
//
// Auth: Bearer ${CRON_SECRET}
//
// GET  ?practice_id=<uuid>        → returns the full row
// POST { practice_id, ...fields } → patches supplied fields, returns before + after

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const VAPI_API_KEY = process.env.VAPI_API_KEY || ''
const VAPI_BASE_URL = 'https://api.vapi.ai'

function formatHoursSync(hoursJson: any): string {
  if (!hoursJson) return 'Monday through Friday, 9am to 5pm'
  if (typeof hoursJson === 'string') return hoursJson
  try {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    const labels: Record<string, string> = {
      monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
      thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
    }
    const parts: string[] = []
    for (const day of days) {
      const h = hoursJson[day]
      if (!h) continue
      if (typeof h === 'object' && 'enabled' in h) {
        if (h.enabled && h.openTime && h.closeTime) {
          const open = fmtT(h.openTime), close = fmtT(h.closeTime)
          parts.push(`${labels[day]}: ${open} - ${close}`)
        }
      } else if (typeof h === 'string' && h !== 'closed') {
        parts.push(`${labels[day]}: ${h}`)
      }
    }
    return parts.length > 0 ? parts.join(', ') : 'Monday through Friday, 9am to 5pm'
  } catch { return 'Monday through Friday, 9am to 5pm' }
}

function fmtT(t: string): string {
  const [hh, mm] = t.split(':').map(Number)
  if (isNaN(hh)) return t
  const suffix = hh >= 12 ? 'PM' : 'AM'
  const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh
  return mm === 0 ? `${h12} ${suffix}` : `${h12}:${mm.toString().padStart(2, '0')} ${suffix}`
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  return !!process.env.CRON_SECRET && auth === expected
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()

  const practiceId = req.nextUrl.searchParams.get('practice_id')
  if (!practiceId) {
    return NextResponse.json({ error: 'practice_id required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('practices')
    .select('*')
    .eq('id', practiceId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'not found' }, { status: 404 })
  }

  return NextResponse.json({ practice: data })
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const practiceId = body.practice_id as string | undefined
  if (!practiceId) {
    return NextResponse.json({ error: 'practice_id required' }, { status: 400 })
  }

  // Snapshot before
  const { data: before, error: readErr } = await supabaseAdmin
    .from('practices')
    .select('*')
    .eq('id', practiceId)
    .single()

  if (readErr || !before) {
    return NextResponse.json({ error: readErr?.message || 'not found' }, { status: 404 })
  }

  // Build patch from everything except practice_id
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (key === 'practice_id') continue
    patch[key] = value
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no fields supplied', before }, { status: 400 })
  }

  const { data: after, error: upErr } = await supabaseAdmin
    .from('practices')
    .update(patch)
    .eq('id', practiceId)
    .select('*')
    .single()

  if (upErr) {
    return NextResponse.json({ error: upErr.message, before }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    patched_keys: Object.keys(patch),
    before,
    after,
  })
}

// PATCH /api/admin/repair-practice?practice_id=<uuid>
// Actions (via query params):
//   (default)           — sync system prompt, voice, greeting to static Vapi assistant
//   enable_dynamic=true — remove assistantId from Vapi phone config
//   restore_static=true — put assistantId back on Vapi phone config
export async function PATCH(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()

  const practiceId = req.nextUrl.searchParams.get('practice_id')
  const enableDynamic = req.nextUrl.searchParams.get('enable_dynamic') === 'true'
  const restoreStatic = req.nextUrl.searchParams.get('restore_static') === 'true'
  if (!practiceId) {
    return NextResponse.json({ error: 'practice_id required' }, { status: 400 })
  }

  const { data: p, error: pErr } = await supabaseAdmin
    .from('practices')
    .select('*')
    .eq('id', practiceId)
    .single()

  if (pErr || !p) {
    return NextResponse.json({ error: pErr?.message || 'not found' }, { status: 404 })
  }
  if (!VAPI_API_KEY) {
    return NextResponse.json({ error: 'VAPI_API_KEY not configured' }, { status: 500 })
  }

  // ---- enable_dynamic: clear assistantId from Vapi phone config ----
  if (enableDynamic) {
    if (!p.vapi_phone_number_id) {
      return NextResponse.json({ error: 'no vapi_phone_number_id on practice' }, { status: 400 })
    }
    const VAPI_WEBHOOK_SECRET = process.env.VAPI_WEBHOOK_SECRET || ''
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
    const serverUrl = VAPI_WEBHOOK_SECRET
      ? `${APP_URL}/api/vapi/webhook?secret=${encodeURIComponent(VAPI_WEBHOOK_SECRET)}`
      : `${APP_URL}/api/vapi/webhook`

    const phoneRes = await fetch(`${VAPI_BASE_URL}/phone-number/${p.vapi_phone_number_id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ assistantId: null, serverUrl }),
    })

    if (!phoneRes.ok) {
      const errBody = await phoneRes.text().catch(() => '')
      return NextResponse.json(
        { error: `vapi_phone_patch_failed (${phoneRes.status})`, body: errBody },
        { status: 502 }
      )
    }

    const phoneResult = await phoneRes.json()
    return NextResponse.json({
      ok: true,
      action: 'enable_dynamic',
      vapi_phone_number_id: p.vapi_phone_number_id,
      assistantId: phoneResult.assistantId ?? '(cleared)',
      serverUrl: phoneResult.serverUrl,
    })
  }

  // ---- restore_static: put assistantId back on Vapi phone config ----
  if (restoreStatic) {
    if (!p.vapi_phone_number_id || !p.vapi_assistant_id) {
      return NextResponse.json({ error: 'practice missing vapi_phone_number_id or vapi_assistant_id' }, { status: 400 })
    }
    const phoneRes = await fetch(`${VAPI_BASE_URL}/phone-number/${p.vapi_phone_number_id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ assistantId: p.vapi_assistant_id }),
    })
    if (!phoneRes.ok) {
      const errBody = await phoneRes.text().catch(() => '')
      return NextResponse.json({ error: `vapi_phone_patch_failed (${phoneRes.status})`, body: errBody }, { status: 502 })
    }
    const phoneResult = await phoneRes.json()
    return NextResponse.json({
      ok: true,
      action: 'restore_static',
      vapi_phone_number_id: p.vapi_phone_number_id,
      assistantId: phoneResult.assistantId,
    })
  }

  // ---- sync_vapi: push system prompt, voice, greeting to static assistant ----
  if (!p.vapi_assistant_id) {
    return NextResponse.json({ error: 'no vapi_assistant_id on practice' }, { status: 400 })
  }

  // Build the full system prompt using the same builder as handleAssistantRequest
  const { buildSystemPrompt } = await import('@/lib/systemPrompt')

  // Fetch therapists so the prompt reflects the current roster + bios.
  const { data: therapistRows } = await supabaseAdmin
    .from('therapists')
    .select('display_name, credentials, bio, is_primary, is_active')
    .eq('practice_id', p.id)
    .eq('is_active', true)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  const systemPrompt = buildSystemPrompt({
    therapist_name: p.provider_name || p.name,
    practice_name: p.name,
    ai_name: p.ai_name || 'Ellie',
    specialties: p.specialties || [],
    hours: formatHoursSync(p.hours_json),
    location: p.location || '',
    telehealth: p.telehealth_available || false,
    insurance_accepted: p.insurance_accepted || [],
    system_prompt_notes: p.system_prompt || '',
    emotional_support_enabled: true,
    self_pay_rate_cents: p.self_pay_rate_cents ?? null,
    therapists: (therapistRows || []).map(t => ({
      display_name: t.display_name,
      credentials: t.credentials,
      bio: t.bio,
    })),
  })

  const aiName = p.ai_name || 'Ellie'
  const greeting =
    p.greeting ||
    `Hi, this is ${aiName} at ${p.name}. How can I help today?`

  const VAPI_WEBHOOK_SECRET = process.env.VAPI_WEBHOOK_SECRET || ''
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
  const serverUrl = VAPI_WEBHOOK_SECRET
    ? `${APP_URL}/api/vapi/webhook?secret=${encodeURIComponent(VAPI_WEBHOOK_SECRET)}`
    : `${APP_URL}/api/vapi/webhook`

  const vapiPatch: Record<string, any> = {
    name: `${aiName} - ${p.name}`,
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
    firstMessage: greeting,
    endCallMessage: `Thank you for calling ${p.name}. Have a wonderful day!`,
    backgroundSound: 'office',
    backchannelingEnabled: true,
    server: { url: serverUrl },
    metadata: {
      practiceId: p.id,
      practiceName: p.name,
    },
  }

  // Build tools array for the Vapi assistant
  const vapiTools = [
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
            appointmentDateTime: { type: 'string', description: 'The chosen appointment date and time, e.g. "Monday April 21 at 2pm"' },
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
        name: 'verifyIdentity',
        description: 'REQUIRED before disclosing any patient details, cancelling, or rescheduling. Verifies caller identity by matching first name + last name + date of birth against the practice records. Returns VERIFICATION_OK:{patientId} when matched, VERIFICATION_FAILED otherwise. Never disclose PHI without a VERIFICATION_OK.',
        parameters: {
          type: 'object',
          properties: {
            firstName: { type: 'string', description: 'Caller first name as they stated it' },
            lastName: { type: 'string', description: 'Caller last name as they stated it' },
            dateOfBirth: { type: 'string', description: 'Caller date of birth in any spoken form - e.g. "November 7, 1990", "11/07/1990", or "1990-11-07"' },
          },
          required: ['firstName', 'lastName', 'dateOfBirth'],
        },
      },
      async: false,
      server: { url: serverUrl },
    },
    {
      type: 'function',
      function: {
        name: 'cancelAppointment',
        description: 'Cancel an existing appointment. MUST be called only after verifyIdentity returned VERIFICATION_OK. Deletes the event from the practice calendar and marks the record cancelled.',
        parameters: {
          type: 'object',
          properties: {
            patientId: { type: 'string', description: 'The patient id returned by verifyIdentity (e.g. "VERIFICATION_OK:abc-123" -> pass "abc-123")' },
            appointmentDateTime: { type: 'string', description: 'The date/time of the appointment to cancel, e.g. "Thursday April 24 at 2pm"' },
          },
          required: ['patientId', 'appointmentDateTime'],
        },
      },
      async: false,
      server: { url: serverUrl },
    },
    {
      type: 'function',
      function: {
        name: 'rescheduleAppointment',
        description: 'Reschedule an existing appointment to a new date and time. MUST be called only after verifyIdentity returned VERIFICATION_OK. Books the new slot first, then cancels the old one, so a failure leaves the original appointment intact.',
        parameters: {
          type: 'object',
          properties: {
            patientId: { type: 'string', description: 'The patient id returned by verifyIdentity' },
            oldAppointmentDateTime: { type: 'string', description: 'The existing appointment date/time, e.g. "Thursday April 24 at 2pm"' },
            newAppointmentDateTime: { type: 'string', description: 'The new appointment date/time the caller wants, e.g. "Friday April 25 at 10am"' },
          },
          required: ['patientId', 'oldAppointmentDateTime', 'newAppointmentDateTime'],
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

  // Set model and tools on the Vapi assistant
  vapiPatch.model = {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    messages: [{ role: 'system', content: systemPrompt }],
    temperature: 0.7,
    tools: vapiTools,
  }
  // Note: Vapi reads tools from model.tools, NOT top-level tools on PATCH

  const res = await fetch(`${VAPI_BASE_URL}/assistant/${p.vapi_assistant_id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(vapiPatch),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    return NextResponse.json(
      { error: `vapi_patch_failed (${res.status})`, body: errBody },
      { status: 502 }
    )
  }

  const vapiResult = await res.json()
  return NextResponse.json({
    ok: true,
    vapi_assistant_id: p.vapi_assistant_id,
    prompt_length: systemPrompt.length,
    greeting_length: greeting.length,
    vapi_name: vapiResult.name,
  })
}
