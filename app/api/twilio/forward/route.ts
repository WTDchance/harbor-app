import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// TwiML content type
const TWIML_CONTENT_TYPE = 'application/xml'

export async function GET(req: NextRequest) {
  try {
    // Get practice_id from query parameters
    const { searchParams } = new URL(req.url)
    const practiceId = searchParams.get('practice_id')

    if (!practiceId) {
      console.warn('[Twilio Forward] Missing practice_id parameter')
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">This number is not available. Please try again later.</Say>
  <Hangup/>
</Response>`
      return new NextResponse(twiml, {
        status: 200,
        headers: { 'Content-Type': TWIML_CONTENT_TYPE },
      })
    }

    // Look up the practice's forwarding number
    const { data: practice, error: practiceError } = await supabaseAdmin
      .from('practices')
      .select('call_forwarding_number, forwarding_enabled')
      .eq('id', practiceId)
      .single()

    if (practiceError || !practice) {
      console.error('[Twilio Forward] Practice lookup error:', practiceError)
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">This number is not available. Please try again later.</Say>
  <Hangup/>
</Response>`
      return new NextResponse(twiml, {
        status: 200,
        headers: { 'Content-Type': TWIML_CONTENT_TYPE },
      })
    }

    // Check if forwarding is enabled and has a number
    if (!practice.forwarding_enabled || !practice.call_forwarding_number) {
      console.warn('[Twilio Forward] Forwarding disabled or no number configured', {
        practiceId,
        forwarding_enabled: practice.forwarding_enabled,
      })
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">This number is not available. Please try again later.</Say>
  <Hangup/>
</Response>`
      return new NextResponse(twiml, {
        status: 200,
        headers: { 'Content-Type': TWIML_CONTENT_TYPE },
      })
    }

    // Build TwiML response to dial the forwarding number
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>${practice.call_forwarding_number}</Dial>
</Response>`

    console.log('[Twilio Forward] Forwarding call', {
      practiceId,
      forwardingNumber: practice.call_forwarding_number,
    })

    return new NextResponse(twiml, {
      status: 200,
      headers: { 'Content-Type': TWIML_CONTENT_TYPE },
    })
  } catch (error) {
    console.error('[Twilio Forward] Error:', error)

    // Return safe fallback TwiML on error
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">We're experiencing technical difficulties. Please try again later.</Say>
  <Hangup/>
</Response>`
    return new NextResponse(twiml, {
      status: 500,
      headers: { 'Content-Type': TWIML_CONTENT_TYPE },
    })
  }
}

export async function POST(req: NextRequest) {
  // Twilio can also POST to this endpoint (webhook), so handle it the same way
  return GET(req)
  }
