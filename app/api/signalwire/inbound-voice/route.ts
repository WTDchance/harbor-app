// app/api/signalwire/inbound-voice/route.ts
//
// Wave 27d — SignalWire inbound voice webhook. SignalWire posts a
// LaML voice payload here when the practice phone rings. We:
//   1. Validate the SignalWire signature.
//   2. Resolve which practice owns the dialled number.
//   3. Register the call with Retell so a fresh agent session
//      kicks off with the right dynamic_variables (practice_id,
//      caller context).
//   4. Return LaML <Connect><Stream> directing the call into
//      Retell's media-stream URL.
//
// This is the single entry point that replaces the legacy Twilio
// → Vapi assistant-request flow.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import {
  validateInboundWebhook,
  publicWebhookUrl,
  laMLConnectToRetell,
  signalwireConfigured,
  computeWebhookSignature,
} from '@/lib/aws/signalwire'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

const TWIML_HEADERS = { 'Content-Type': 'application/xml' }

function rejectTwiML(reason: string): NextResponse {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">This number is not available right now. Please try again later.</Say>
  <Hangup/>
</Response>`
  return new NextResponse(twiml, { status: 200, headers: TWIML_HEADERS })
}

export async function POST(req: NextRequest) {
  if (!signalwireConfigured()) {
    return rejectTwiML('signalwire_not_configured')
  }

  // Parse + validate
  const formData = await req.formData()
  const formParams: Record<string, string> = {}
  for (const [k, v] of formData.entries()) formParams[k] = String(v)
  const sig = req.headers.get('x-twilio-signature') || req.headers.get('x-signalwire-signature')

  // Wave 27o — temporary diagnostic dump while signature validation is
  // bypassed in staging. Logs everything needed to reverse-engineer the
  // mismatch (headers, reconstructed URL, sorted params, our HMAC vs
  // SignalWire's). Remove once the algorithm is fixed and validation is
  // re-enabled.
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
      console.log('[SW-DEBUG] inbound-voice ' + JSON.stringify({
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
      console.log('[SW-DEBUG] inbound-voice logging failed:', (e as Error).message)
    }
  }

  const sigOk = validateInboundWebhook({
    rawUrl: publicWebhookUrl(req),
    formParams,
    signatureHeader: sig,
  })
  if (!sigOk && process.env.SIGNALWIRE_VALIDATE_INBOUND !== 'false') {
    await auditSystemEvent({
      action: 'signalwire.inbound_voice.bad_signature',
      severity: 'warn',
      details: { from: formParams.From, to: formParams.To, callSid: formParams.CallSid },
    })
    return new NextResponse('forbidden', { status: 403 })
  }

  const fromNumber = formParams.From
  const toNumber = formParams.To
  const callSid = formParams.CallSid

  // Resolve practice by the called number
  const { rows: pRows } = await pool.query(
    `SELECT id, name, signalwire_number, twilio_phone_number, owner_email
       FROM practices
      WHERE signalwire_number = $1
         OR twilio_phone_number = $1
         OR phone = $1
      LIMIT 1`,
    [toNumber],
  )
  const practice = pRows[0]
  if (!practice) {
    await auditSystemEvent({
      action: 'signalwire.inbound_voice.unknown_number',
      severity: 'warn',
      details: { from: fromNumber, to: toNumber, callSid },
    })
    return rejectTwiML('unknown_practice')
  }

  // Pre-fetch caller context (best-effort — agent prompt handles missing fields)
  let callerCtx: Record<string, string> = {
    practice_id: practice.id,
    practice_name: practice.name || '',
    therapist_name: '',
    caller_is_existing_patient: 'no',
    caller_first_name: '',
    caller_last_name: '',
    caller_billing_mode: '',
    caller_intake_completed: '',
    caller_last_appointment_at: '',
    caller_last_appointment_status: '',
    caller_next_appointment_at: '',
    caller_next_appointment_status: '',
    caller_insurance_provider: '',
  }
  try {
    const normalizedFrom = (fromNumber || '').replace(/\D/g, '').slice(-10)
    if (normalizedFrom.length >= 10) {
      const { rows: patientRows } = await pool.query(
        `SELECT first_name, last_name, billing_mode, intake_completed,
                insurance_provider
           FROM patients
          WHERE practice_id = $1 AND phone ILIKE $2 AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 1`,
        [practice.id, `%${normalizedFrom}`],
      )
      if (patientRows[0]) {
        const p = patientRows[0]
        callerCtx.caller_is_existing_patient = 'yes'
        callerCtx.caller_first_name = p.first_name || ''
        callerCtx.caller_last_name = p.last_name || ''
        callerCtx.caller_billing_mode = p.billing_mode || ''
        callerCtx.caller_intake_completed = p.intake_completed ? 'yes' : 'no'
        callerCtx.caller_insurance_provider = p.insurance_provider || ''
      }
    }
  } catch {}

  // Register the call with Retell so the agent inherits dynamic vars
  const agentId = process.env.RETELL_AGENT_ID || ''
  const retellApiKey = process.env.RETELL_API_KEY || ''
  if (!agentId || !retellApiKey) {
    return rejectTwiML('retell_not_configured')
  }
  // Wave 27p — corrected to /v2/register-phone-call (the un-versioned path 404s)
  // and surface non-2xx loudly so future regressions don't silently drop dynamic vars.
  try {
    const resp = await fetch('https://api.retellai.com/v2/register-phone-call', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${retellApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agent_id: agentId,
        from_number: fromNumber,
        to_number: toNumber,
        retell_llm_dynamic_variables: callerCtx,
        metadata: { practice_id: practice.id, call_sid: callSid },
      }),
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      console.error(
        '[signalwire/inbound-voice] register-call HTTP',
        resp.status,
        body.slice(0, 200),
      )
    }
  } catch (err) {
    console.error('[signalwire/inbound-voice] register-call failed:', (err as Error).message)
    // Not fatal — the LaML below still streams to the same agent_id
  }

  await auditSystemEvent({
    action: 'signalwire.inbound_voice.routed',
    severity: 'info',
    practiceId: practice.id,
    details: { from: fromNumber, to: toNumber, callSid, agent_id: agentId },
  })

  const twiml = laMLConnectToRetell({
    agentId,
    callMetadata: { practice_id: practice.id, call_sid: callSid || '' },
  })
  return new NextResponse(twiml, { status: 200, headers: TWIML_HEADERS })
}
