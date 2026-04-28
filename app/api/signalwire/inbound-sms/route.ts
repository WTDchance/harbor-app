// app/api/signalwire/inbound-sms/route.ts
//
// Wave 27d — SignalWire inbound SMS webhook. Handles STOP / START /
// HELP keywords (TCPA / A2P compliance) and persists every message
// into sms_conversations. AI auto-response is intentionally deferred
// to a later wave (the legacy Claude SMS responder lives in
// /api/sms/inbound on Supabase + Twilio and gets ported separately
// once the carrier swap is fully validated).

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { validateInboundWebhook, signalwireConfigured, publicWebhookUrl, computeWebhookSignature } from '@/lib/aws/signalwire'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

const TWIML_HEADERS = { 'Content-Type': 'application/xml' }

function twimlReply(message: string | null): string {
  if (!message) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response/>`
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
}

function classifyKeyword(body: string): 'stop' | 'start' | 'help' | null {
  const t = (body || '').trim().toUpperCase()
  if (t === 'STOP' || t === 'STOPALL' || t === 'UNSUBSCRIBE' || t === 'CANCEL' || t === 'END' || t === 'QUIT') return 'stop'
  if (t === 'START' || t === 'YES' || t === 'UNSTOP') return 'start'
  if (t === 'HELP' || t === 'INFO') return 'help'
  return null
}

export async function POST(req: NextRequest) {
  if (!signalwireConfigured()) {
    return new NextResponse(twimlReply(null), { headers: TWIML_HEADERS })
  }

  const formData = await req.formData()
  const formParams: Record<string, string> = {}
  for (const [k, v] of formData.entries()) formParams[k] = String(v)
  const sig = req.headers.get('x-twilio-signature') || req.headers.get('x-signalwire-signature')

  // Wave 27o — temporary diagnostic dump while signature validation is
  // bypassed in staging.
  if (process.env.SIGNALWIRE_VALIDATE_INBOUND === 'false') {
    try {
      const allHeaders = Object.fromEntries(Array.from(req.headers.entries()))
      const reconstructedUrl = publicWebhookUrl(req)
      const sortedFormParams: Record<string, string> = {}
      for (const k of Object.keys(formParams).sort()) sortedFormParams[k] = formParams[k]
      const { buf, hmac } = computeWebhookSignature({
        rawUrl: reconstructedUrl,
        formParams,
      })
      console.log('[SW-DEBUG] inbound-sms ' + JSON.stringify({
        rawReqUrl: req.url,
        reconstructedUrl,
        method: req.method,
        headers: allHeaders,
        sortedFormParams,
        bufferSigned: buf,
        ourHmacBase64: hmac,
        candidateSignatureHeaders: {
          'x-twilio-signature': req.headers.get('x-twilio-signature'),
          'x-signalwire-signature': req.headers.get('x-signalwire-signature'),
          'signature': req.headers.get('signature'),
          'x-signature': req.headers.get('x-signature'),
        },
        chosenSignatureHeader: sig,
      }))
    } catch (e) {
      console.log('[SW-DEBUG] inbound-sms logging failed:', (e as Error).message)
    }
  }

  const sigOk = validateInboundWebhook({
    rawUrl: publicWebhookUrl(req),
    formParams,
    signatureHeader: sig,
  })
  if (!sigOk && process.env.SIGNALWIRE_VALIDATE_INBOUND !== 'false') {
    await auditSystemEvent({
      action: 'signalwire.inbound_sms.bad_signature',
      severity: 'warning',
      details: { from: formParams.From, to: formParams.To },
    })
    return new NextResponse('forbidden', { status: 403 })
  }

  const fromNumber = formParams.From || ''
  const toNumber = formParams.To || ''
  const body = formParams.Body || ''
  const messageSid = formParams.MessageSid || formParams.SmsSid || null

  // Resolve practice
  const { rows: pRows } = await pool.query(
    `SELECT id, name FROM practices
      WHERE signalwire_number = $1 OR twilio_phone_number = $1 OR phone = $1
      LIMIT 1`,
    [toNumber],
  )
  const practice = pRows[0]
  if (!practice) {
    await auditSystemEvent({
      action: 'signalwire.inbound_sms.unknown_number',
      severity: 'warning',
      details: { from: fromNumber, to: toNumber, body: body.slice(0, 80) },
    })
    return new NextResponse(twimlReply(null), { headers: TWIML_HEADERS })
  }

  // Persist conversation row (UPSERT on (practice_id, patient_phone))
  try {
    await pool.query(
      `INSERT INTO sms_conversations
          (practice_id, patient_phone, last_message_at, last_message_body,
           last_message_direction)
        VALUES ($1, $2, NOW(), $3, 'inbound')
        ON CONFLICT (practice_id, patient_phone) DO UPDATE
          SET last_message_at = NOW(),
              last_message_body = EXCLUDED.last_message_body,
              last_message_direction = EXCLUDED.last_message_direction`,
      [practice.id, fromNumber, body.slice(0, 1000)],
    )
  } catch (err) {
    console.error('[signalwire/inbound-sms] sms_conversations upsert failed:', (err as Error).message)
  }

  // STOP / START / HELP keywords — TCPA-required handling
  const keyword = classifyKeyword(body)
  if (keyword === 'stop') {
    await pool.query(
      `INSERT INTO sms_opt_outs (practice_id, phone, keyword, source)
        VALUES ($1, $2, $3, 'inbound_sms')
        ON CONFLICT (practice_id, phone) DO UPDATE
          SET keyword = EXCLUDED.keyword, source = EXCLUDED.source`,
      [practice.id, fromNumber, body.trim().toUpperCase()],
    )
    await auditSystemEvent({
      action: 'signalwire.inbound_sms.opt_out',
      severity: 'info',
      practiceId: practice.id,
      details: { from: fromNumber, keyword },
    })
    return new NextResponse(
      twimlReply(`You have been unsubscribed from ${practice.name} messages. No further messages will be sent. Reply START to resubscribe.`),
      { headers: TWIML_HEADERS },
    )
  }
  if (keyword === 'start') {
    await pool.query(
      `DELETE FROM sms_opt_outs WHERE practice_id = $1 AND phone = $2`,
      [practice.id, fromNumber],
    )
    await auditSystemEvent({
      action: 'signalwire.inbound_sms.opt_in',
      severity: 'info',
      practiceId: practice.id,
      details: { from: fromNumber },
    })
    return new NextResponse(
      twimlReply(`You're resubscribed to ${practice.name}. Reply STOP to opt out, HELP for help.`),
      { headers: TWIML_HEADERS },
    )
  }
  if (keyword === 'help') {
    return new NextResponse(
      twimlReply(`${practice.name}: Reply STOP to opt out. Standard message and data rates may apply.`),
      { headers: TWIML_HEADERS },
    )
  }

  // No auto-response yet (Claude responder deferred). Empty TwiML so
  // SignalWire doesn't auto-reply with anything.
  await auditSystemEvent({
    action: 'signalwire.inbound_sms.received',
    severity: 'info',
    practiceId: practice.id,
    resourceId: messageSid,
    details: { from: fromNumber, length: body.length },
  })
  return new NextResponse(twimlReply(null), { headers: TWIML_HEADERS })
}
