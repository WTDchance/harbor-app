// Admin-only: attach a Vapi assistant + phone-number link to an EXISTING
// practice that already has a Twilio number but no vapi_assistant_id.
// Used to retrofit Vapi onto practices created outside the normal signup
// flow (e.g. the internal Harbor Demo line).
//
// Auth: Bearer ${CRON_SECRET}
// POST { practice_id }
//
// Behavior:
//   - Loads the practice
//   - Refuses if it already has a vapi_assistant_id (use a separate
//     reset endpoint if you really want to replace it)
//   - Refuses if it has no phone_number
//   - Calls createVapiAssistant + linkVapiPhoneNumber
//   - Writes vapi_assistant_id + vapi_phone_number_id back

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  createVapiAssistant,
  linkVapiPhoneNumber,
  deleteVapiAssistant,
} from '@/lib/vapi-provision'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { practice_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const practiceId = body.practice_id
  if (!practiceId) {
    return NextResponse.json({ error: 'practice_id_required' }, { status: 400 })
  }

  const { data: p, error: pErr } = await supabaseAdmin
    .from('practices')
    .select('*')
    .eq('id', practiceId)
    .single()

  if (pErr || !p) {
    return NextResponse.json({ error: 'practice_not_found' }, { status: 404 })
  }
  if (!p.phone_number) {
    return NextResponse.json(
      { error: 'practice_has_no_phone_number' },
      { status: 400 }
    )
  }
  if (p.vapi_assistant_id) {
    return NextResponse.json(
      {
        error: 'already_has_assistant',
        vapi_assistant_id: p.vapi_assistant_id,
      },
      { status: 409 }
    )
  }

  const aiName = p.ai_name || 'Ellie'
  const providerName = p.therapist_name || 'the therapist'
  const greeting =
    p.greeting ||
    `Hi, this is ${aiName}, the AI receptionist at ${p.name}. How can I help today?`

  let assistantId: string | null = null
  try {
    assistantId = await createVapiAssistant({
      id: p.id,
      name: p.name,
      providerName,
      aiName,
      greeting,
      specialties: p.specialties || [],
      insuranceAccepted: p.insurance_accepted || [],
      location: p.location,
      telehealth: !!p.telehealth,
      timezone: p.timezone,
    })

    // If practice has a custom system_prompt, override the default one so the
    // demo-line prompt (or any custom prompt) actually drives Ellie's behavior.
    if (p.system_prompt) {
      try {
        await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${process.env.VAPI_API_KEY || ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: {
              provider: 'anthropic',
              model: 'claude-3-5-haiku-20241022',
              messages: [{ role: 'system', content: p.system_prompt }],
              temperature: 0.7,
            },
          }),
        })
      } catch (e) {
        console.warn('[attach-vapi] custom prompt patch failed:', e)
      }
    }

    const phoneRecordId = await linkVapiPhoneNumber({
      assistantId,
      twilioPhoneNumber: p.phone_number,
      practiceName: p.name,
    })

    const { error: upErr } = await supabaseAdmin
      .from('practices')
      .update({
        vapi_assistant_id: assistantId,
        vapi_phone_number_id: phoneRecordId,
        provisioned_at: new Date().toISOString(),
        provisioning_error: null,
      })
      .eq('id', practiceId)

    if (upErr) {
      throw new Error(`practice_update_failed: ${upErr.message}`)
    }

    return NextResponse.json({
      ok: true,
      practice_id: practiceId,
      vapi_assistant_id: assistantId,
      vapi_phone_number_id: phoneRecordId,
    })
  } catch (e: any) {
    if (assistantId) {
      deleteVapiAssistant(assistantId).catch(() => {})
    }
    console.error('[attach-vapi] error:', e)
    return NextResponse.json(
      { error: e?.message || 'attach_failed' },
      { status: 500 }
    )
  }
}
