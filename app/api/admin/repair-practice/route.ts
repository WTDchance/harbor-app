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

// PATCH /api/admin/repair-practice?practice_id=<uuid>&sync_vapi=true
// Reads the practice's current system_prompt (or auto-generates one from
// practice fields) and PATCHes the linked Vapi assistant's model.messages
// so the voice agent matches the DB. Also syncs the firstMessage (greeting).
export async function PATCH(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized()

  const practiceId = req.nextUrl.searchParams.get('practice_id')
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
  if (!p.vapi_assistant_id) {
    return NextResponse.json({ error: 'no vapi_assistant_id on practice' }, { status: 400 })
  }
  if (!VAPI_API_KEY) {
    return NextResponse.json({ error: 'VAPI_API_KEY not configured' }, { status: 500 })
  }

  // Use custom system_prompt if present, otherwise build a basic one
  const systemPrompt =
    p.system_prompt ||
    [
      `You are ${p.ai_name || 'the receptionist'}, the AI receptionist for ${p.name}.`,
      `${p.therapist_name || 'The therapist'} is the provider.`,
      p.location ? `Located in ${p.location}.` : '',
      p.specialties?.length ? `Specialties: ${p.specialties.join(', ')}.` : '',
      p.insurance_accepted?.length ? `Insurance: ${p.insurance_accepted.join(', ')}.` : '',
      p.telehealth ? 'Telehealth available.' : 'In-person only.',
      'Be warm, professional, and HIPAA-conscious.',
      'If a caller expresses suicidal thoughts or crisis signals, provide 988 immediately.',
    ]
      .filter(Boolean)
      .join(' ')

  const greeting =
    p.greeting ||
    `Hi, this is ${p.ai_name || 'the receptionist'} at ${p.name}. How can I help today?`

  const aiName = p.ai_name || 'Receptionist'

  const vapiPatch: Record<string, any> = {
    name: `${aiName} - ${p.name}`,
    model: {
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'system', content: systemPrompt }],
      temperature: 0.7,
    },
    firstMessage: greeting,
    endCallMessage: `Thank you for calling ${p.name}. Have a wonderful day!`,
    backgroundSound: 'office',
    backchannelingEnabled: true,
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
