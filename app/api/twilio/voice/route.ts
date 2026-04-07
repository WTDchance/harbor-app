// Twilio primary voice handler.
//
// This is the URL Twilio hits on every inbound call to a Harbor-managed
// number. It looks up the practice by the dialed number, evaluates the
// call forwarding config, and returns TwiML that either:
//   1. Forwards the call to the therapist's cell (if in forwarding window), OR
//   2. Redirects Twilio to Vapi so Ellie answers.
//
// Configured in Twilio phone number settings under "A call comes in":
//   https://harborreceptionist.com/api/twilio/voice
//
// This REPLACES the direct Twilio → Vapi webhook configuration. We put
// Harbor in the loop so we can make the forwarding decision ourselves.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  decideRouting,
  twimlForDecision,
  ForwardingConfig,
} from '@/lib/call-forwarding'

// The Vapi inbound TwiML URL — same as what Twilio used to be pointed at.
// Vapi expects to receive the original Twilio POST here.
const VAPI_INBOUND_URL = 'https://api.vapi.ai/twilio/inbound_call'

function twimlResponse(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

function fallbackToVapi(): NextResponse {
  // If anything goes wrong, default to Vapi so calls are still answered.
  return twimlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${VAPI_INBOUND_URL}</Redirect>
</Response>`)
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const to = formData.get('To') as string | null
    const from = formData.get('From') as string | null

    console.log('[twilio/voice] Inbound call', { to, from })

    if (!to) {
      console.error('[twilio/voice] No "To" param — routing to Vapi as default')
      return fallbackToVapi()
    }

    const { data: practice, error } = await supabaseAdmin
      .from('practices')
      .select(`
        id,
        name,
        call_forwarding_enabled,
        call_forwarding_mode,
        call_forwarding_number,
        call_forwarding_schedule,
        call_forwarding_fallback,
        timezone,
        business_hours
      `)
      .eq('phone_number', to)
      .single()

    if (error || !practice) {
      console.error('[twilio/voice] Practice lookup failed — defaulting to Vapi', { to, error })
      return fallbackToVapi()
    }

    const config: ForwardingConfig = {
      call_forwarding_enabled: practice.call_forwarding_enabled,
      call_forwarding_mode: practice.call_forwarding_mode,
      call_forwarding_number: practice.call_forwarding_number,
      call_forwarding_schedule: practice.call_forwarding_schedule,
      call_forwarding_fallback: practice.call_forwarding_fallback,
      timezone: practice.timezone,
      business_hours: practice.business_hours,
    }

    const decision = decideRouting(config)
    console.log('[twilio/voice] Routing decision', {
      practiceId: practice.id,
      practiceName: practice.name,
      decision,
    })

    return twimlResponse(twimlForDecision(decision, VAPI_INBOUND_URL, from || undefined))
  } catch (err) {
    console.error('[twilio/voice] Unexpected error — defaulting to Vapi', err)
    return fallbackToVapi()
  }
}
