// app/api/admin/test-sms/route.ts
//
// Wave 41 — admin test SMS endpoint, ported off Twilio.
// Sends through SignalWire's LaML endpoint via lib/aws/signalwire so the
// HIPAA stack stays SignalWire/Retell only. The SMS_ENABLED env gate is
// intentionally bypassed (point of this endpoint) for post-rollout
// verification before the gate is flipped on.
//
// POST /api/admin/test-sms  Authorization: Bearer ${CRON_SECRET}
//   Body: { to: string, body?: string, from?: string }
//   Sends a test SMS. If `from` is omitted we look up Harbor's primary
//   demo practice number from the practices table.
//
// GET /api/admin/test-sms?sid=<message_sid>  Authorization: Bearer ${CRON_SECRET}
//   Fetches delivery status + error info for a previously-sent message.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const PROJECT_ID = process.env.SIGNALWIRE_PROJECT_ID || ''
const TOKEN = process.env.SIGNALWIRE_TOKEN || ''
const SPACE_URL = process.env.SIGNALWIRE_SPACE_URL || ''

function authHeader(): string {
  return 'Basic ' + Buffer.from(PROJECT_ID + ':' + TOKEN).toString('base64')
}

function laMLBase(): string {
  return `https://${SPACE_URL}/api/laml/2010-04-01/Accounts/${PROJECT_ID}`
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = 'Bearer ' + (process.env.CRON_SECRET || '')
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const to: string | undefined = body?.to
  const msg: string = body?.body || 'Harbor test SMS - if you are reading this, the SignalWire path is working.'
  let from: string | undefined = body?.from

  if (!to) {
    return NextResponse.json({ error: 'to is required' }, { status: 400 })
  }

  if (!from) {
    const { data: p } = await supabaseAdmin
      .from('practices')
      .select('phone_number, signalwire_number')
      .eq('id', '172405dd-65f9-46ce-88e9-104c68d24da4')
      .maybeSingle()
    from = (p as any)?.signalwire_number || (p as any)?.phone_number || undefined
    if (!from) {
      return NextResponse.json({ error: 'No from number available' }, { status: 500 })
    }
  }

  if (!PROJECT_ID || !TOKEN || !SPACE_URL) {
    return NextResponse.json({ error: 'SignalWire credentials not configured' }, { status: 500 })
  }

  const form = new URLSearchParams()
  form.set('From', from)
  form.set('To', to)
  form.set('Body', msg)

  const resp = await fetch(`${laMLBase()}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })

  const json: any = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    return NextResponse.json({
      ok: false,
      status: resp.status,
      error: json?.message || 'SignalWire send failed',
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

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = 'Bearer ' + (process.env.CRON_SECRET || '')
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sid = req.nextUrl.searchParams.get('sid')
  if (!sid) return NextResponse.json({ error: 'sid required' }, { status: 400 })

  if (!PROJECT_ID || !TOKEN || !SPACE_URL) {
    return NextResponse.json({ error: 'SignalWire credentials not configured' }, { status: 500 })
  }
  const resp = await fetch(`${laMLBase()}/Messages/${sid}.json`, {
    headers: { 'Authorization': authHeader() },
  })
  const json: any = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    return NextResponse.json({
      ok: false,
      status: resp.status,
      error: json?.message,
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
    error_code: json?.error_code,
    error_message: json?.error_message,
    date_created: json?.date_created,
    date_sent: json?.date_sent,
    date_updated: json?.date_updated,
    num_segments: json?.num_segments,
    price: json?.price,
  })
}
