// Admin-only test SMS endpoint - bypasses the SMS_ENABLED env gate so post-A2P
// verification can happen before the Railway env var flip.
//
// POST /api/admin/test-sms
//   Headers: Authorization: Bearer <CRON_SECRET>
//   Body:    { to: "+15551234567", body: "Hello", from?: "+1541..." }
//
// If \"from\" is omitted, uses the Harbor Demo practice's Twilio number.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import twilio from 'twilio'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const to = body?.to
  const msg = body?.body || 'Harbor test SMS - if you are reading this, A2P is working.'
  let from = body?.from

  if (!to) {
    return NextResponse.json({ error: 'to is required' }, { status: 400 })
  }

  if (!from) {
    const { data: p } = await supabaseAdmin
      .from('practices')
      .select('phone_number')
      .eq('id', '172405dd-65f9-46ce-88e9-104c68d24da4')
      .maybeSingle()
    from = p?.phone_number
    if (!from) {
      return NextResponse.json({ error: 'No from number available' }, { status: 500 })
    }
  }

  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) {
    return NextResponse.json({ error: 'Twilio credentials not configured' }, { status: 500 })
  }

  try {
    const client = twilio(sid, token)
    const message = await client.messages.create({ from, to, body: msg })
    return NextResponse.json({
      ok: true,
      sid: message.sid,
      status: message.status,
      from: message.from,
      to: message.to,
    })
  } catch (err: any) {
    console.error('[test-sms] send failed:', err?.message || err)
    return NextResponse.json({
      ok: false,
      error: err?.message || String(err),
      code: err?.code,
      moreInfo: err?.moreInfo,
    }, { status: 500 })
  }
}
