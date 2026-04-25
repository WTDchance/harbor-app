// Temporary diagnostic endpoint for tracing call pipeline issues
// Auth: Bearer ${CRON_SECRET}
// GET /api/admin/call-diag?practice_id=<uuid>

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const practiceId = req.nextUrl.searchParams.get('practice_id')
  if (!practiceId) {
    return NextResponse.json({ error: 'practice_id required' }, { status: 400 })
  }

  // Recent call logs (use * to avoid column name mismatches)
  const { data: calls, error: callErr } = await supabaseAdmin
    .from('call_logs')
    .select('*')
    .eq('practice_id', practiceId)
    .order('created_at', { ascending: false })
    .limit(10)

  // Recent intake forms
  const { data: intakes, error: intakeErr } = await supabaseAdmin
    .from('intake_forms')
    .select('*')
    .eq('practice_id', practiceId)
    .order('created_at', { ascending: false })
    .limit(10)

  // Recent patients
  const { data: patients, error: patErr } = await supabaseAdmin
    .from('patients')
    .select('id, first_name, last_name, phone, email, created_at')
    .eq('practice_id', practiceId)
    .order('created_at', { ascending: false })
    .limit(10)

  // Check Vapi assistant config if practice has one
  let vapiAssistant: any = null
  const { data: practice } = await supabaseAdmin
    .from('practices')
    .select('vapi_assistant_id')
    .eq('id', practiceId)
    .single()

  if (practice?.vapi_assistant_id && process.env.VAPI_API_KEY) {
    try {
      const vapiRes = await fetch(`https://api.vapi.ai/assistant/${practice.vapi_assistant_id}`, {
        headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
      })
      if (vapiRes.ok) {
        const full = await vapiRes.json()
        vapiAssistant = {
          id: full.id,
          name: full.name,
          model_provider: full.model?.provider,
          model_name: full.model?.model,
          server_url: full.server?.url || full.serverUrl || '(not set)',
          firstMessage: full.firstMessage?.substring(0, 100),
        }
      }
    } catch { /* swallow */ }
  }

  // Check Vapi phone number config
  let vapiPhoneConfig: any = null
  const { data: practicePhone } = await supabaseAdmin
    .from('practices')
    .select('vapi_phone_number_id')
    .eq('id', practiceId)
    .single()

  if (practicePhone?.vapi_phone_number_id && process.env.VAPI_API_KEY) {
    try {
      const phoneRes = await fetch(`https://api.vapi.ai/phone-number/${practicePhone.vapi_phone_number_id}`, {
        headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
      })
      if (phoneRes.ok) {
        const ph = await phoneRes.json()
        vapiPhoneConfig = {
          id: ph.id,
          number: ph.number,
          assistantId: ph.assistantId || '(not set)',
          serverUrl: ph.serverUrl || ph.server?.url || '(not set)',
          squadId: ph.squadId || null,
        }
      }
    } catch { /* swallow */ }
  }

  return NextResponse.json({
    call_logs: { data: calls, error: callErr?.message },
    intake_forms: { data: intakes, error: intakeErr?.message },
    patients: { data: patients, error: patErr?.message },
    vapi_assistant: vapiAssistant,
    vapi_phone: vapiPhoneConfig,
  })
}

// POST /api/admin/call-diag — fix Vapi phone number serverUrl mismatch
// Body: { practice_id, action: 'fix-phone-server-url' }
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const body = await req.json()
  const { practice_id, action } = body

  if (action !== 'fix-phone-server-url') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }

  const { data: p } = await supabaseAdmin
    .from('practices')
    .select('vapi_phone_number_id, vapi_assistant_id')
    .eq('id', practice_id)
    .single()

  if (!p?.vapi_phone_number_id || !process.env.VAPI_API_KEY) {
    return NextResponse.json({ error: 'missing vapi_phone_number_id or VAPI_API_KEY' }, { status: 400 })
  }

  // Build the correct serverUrl with secret
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
  const webhookSecret = process.env.VAPI_WEBHOOK_SECRET
  const correctServerUrl = webhookSecret
    ? `${baseUrl}/api/vapi/webhook?secret=${encodeURIComponent(webhookSecret)}`
    : `${baseUrl}/api/vapi/webhook`

  // PATCH the Vapi phone number to use the correct serverUrl
  const patchRes = await fetch(`https://api.vapi.ai/phone-number/${p.vapi_phone_number_id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ serverUrl: correctServerUrl }),
  })

  if (!patchRes.ok) {
    const errText = await patchRes.text()
    return NextResponse.json({ error: `vapi patch failed: ${patchRes.status}`, body: errText }, { status: 502 })
  }

  const result = await patchRes.json()
  return NextResponse.json({
    ok: true,
    phone_id: p.vapi_phone_number_id,
    new_server_url: correctServerUrl,
    vapi_response_server_url: result.serverUrl,
  })
}
