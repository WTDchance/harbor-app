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
    model: {
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'system', content: systemPrompt }],
      temperature: 0.7,
    },
    voice: {
      provider: '11labs',
      voiceId: 'EXAVITQu4vr4xnSDxMaL',
      model: 'eleven_turbo_v2_5',
      stability: 0.5,
      similarityBoost: 0.8,
      speed: 1.0,
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
