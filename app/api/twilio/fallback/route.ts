// Twilio fallback URL — hit when the primary voice handler (Vapi) fails.
// Returns TwiML that dials the practice's configured forwarding number
// (or a global emergency default if no practice can be matched).
//
// Configured in Twilio phone number settings under "Primary Handler Fails":
//   https://harborreceptionist.com/api/twilio/fallback
//
// This route must be ultra-simple and fail-safe — it is the last line of
// defense when everything else is broken.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Global emergency fallback — used if we cannot identify the practice.
// This is Dr. Trace's cell for the MVP single-practice test environment.
// In production with multiple practices, this should be an on-call number
// owned by Harbor, not any single therapist.
const GLOBAL_EMERGENCY_FALLBACK = '+15418920518'

function twimlDial(number: string, message?: string): string {
  const say = message
    ? `<Say voice="Polly.Joanna">${message}</Say>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say}
  <Dial timeout="25" callerId="{{From}}">
    <Number>${number}</Number>
  </Dial>
  <Say voice="Polly.Joanna">We were unable to connect your call. Please try again later.</Say>
</Response>`
}

function twimlResponse(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

export async function POST(req: NextRequest) {
  try {
    // Twilio posts form-encoded data
    const formData = await req.formData()
    const to = formData.get('To') as string | null      // the Twilio number that was called
    const from = formData.get('From') as string | null  // the caller's number

    console.log('[twilio/fallback] Triggered', { to, from })

    if (!to) {
      console.error('[twilio/fallback] No "To" param, using global fallback')
      return twimlResponse(twimlDial(GLOBAL_EMERGENCY_FALLBACK))
    }

    // Look up the practice by the Twilio number that was dialed.
    // `practices.twilio_number` is the source of truth for routing.
    const { data: practice, error } = await supabaseAdmin
      .from('practices')
      .select('id, name, call_forwarding_number')
      .eq('phone_number', to)
      .single()

    if (error || !practice) {
      console.error('[twilio/fallback] Practice lookup failed, using global fallback', { to, error })
      return twimlResponse(twimlDial(GLOBAL_EMERGENCY_FALLBACK))
    }

    const fallbackNumber = practice.call_forwarding_number || GLOBAL_EMERGENCY_FALLBACK
    console.log('[twilio/fallback] Dialing fallback for practice', {
      practiceId: practice.id,
      practiceName: practice.name,
      fallbackNumber,
    })

    return twimlResponse(twimlDial(fallbackNumber))
  } catch (err) {
    // Catch-all: if anything at all goes wrong, still dial the global fallback.
    // Never return a 500 from this route — Twilio will drop the call.
    console.error('[twilio/fallback] Unexpected error, using global fallback', err)
    return twimlResponse(twimlDial(GLOBAL_EMERGENCY_FALLBACK))
  }
}

// Also respond to GET so Twilio webhook validation and manual curl tests work.
export async function GET() {
  return twimlResponse(twimlDial(GLOBAL_EMERGENCY_FALLBACK,
    'Harbor fallback is online.'))
}
