// Admin-only test SMS endpoint - bypasses the SMS_ENABLED env gate so post-A2P
// verification can happen before the Railway env var flip.
//
// Uses the Twilio REST API directly via fetch + Basic auth to avoid any
// Twilio SDK type churn in this route.
//
// POST /api/admin/test-sms
// Headers: Authorization Bearer CRON_SECRET
// Body: JSON with to, body, optional from

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = 'Bearer ' + (process.env.CRON_SECRET || '')
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const to: string | undefined = body?.to
  const msg: string = body?.body || 'Harbor test SMS - if you are reading this, A2P is working.'
  let from: string | undefined = body?.from

  if (!to) {
    return NextResponse.json({ error: 'to is required' }, { status: 400 })
  }

  if (!from) {
    const { data: p } = await supabaseAdmin
      .from('practices')
      .select('phone_number')
      .eq('id', '172405dd-65f9-46ce-88e9-104c68d24da4')
      .maybeSingle()
    from = p?.phone_number || undefined
    if (!from) {
      return NextResponse.json({ error: 'No from number available' }, { status: 500 })
    }
  }

  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) {
    return NextResponse.json({ error: 'Twilio credentials not configured' }, { status: 500 })
  }

  const auth64 = Buffer.from(sid + ':' + token).toString('base64')
  const form = new URLSearchParams()
  form.set('From', from)
  form.set('To', to)
  form.set('Body', msg)

  const resp = await fetch(
    'https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json',
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + auth64,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    }
  )

  const json: any = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    return NextResponse.json({
      ok: false,
      status: resp.status,
      error: json?.message || 'Twilio send failed',
      code: json?.code,
      more_info: json?.more_info,
    }, { status: 500 })
  }
  return NextResponse.json({
    ok: true,
    sid: json?.sid,
    status: json?.status,
    from: json?.from,
    to: json?.to,
  })
}
