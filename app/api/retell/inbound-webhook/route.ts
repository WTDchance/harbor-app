// app/api/retell/inbound-webhook/route.ts
//
// Wave 28 — Retell inbound webhook. Retell calls this URL when an
// inbound call rings on a phone number we've imported (via
// /import-phone-number with inbound_webhook_url set). We respond with
// per-call context (override agent, dynamic_variables, metadata) that
// Retell uses for that specific call.
//
// (https://docs.retellai.com/features/inbound-call-webhook)
//
// Auth: Retell signs the webhook the same way as call lifecycle
// events — x-retell-signature header in v=...,d=... format.
//
// Response shape:
//   { call_inbound: { override_agent_id?, dynamic_variables?, metadata? } }
//
// Webhook timeout: 10 seconds. Up to 3 retries on non-2xx.

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

const SIGNATURE_RE = /v=(\d+),d=(.+)/

function verifySignature(rawBody: string, signature: string | null): boolean {
  const apiKey = process.env.RETELL_API_KEY || ''
  if (!apiKey || !signature) return false
  const m = SIGNATURE_RE.exec(signature.trim())
  if (!m) return false
  const timestamp = m[1]
  const providedDigest = m[2]
  const now = Date.now()
  const sent = parseInt(timestamp, 10)
  if (!Number.isFinite(sent)) return false
  if (Math.abs(now - sent) > 5 * 60 * 1000) return false
  const computed = createHmac('sha256', apiKey).update(rawBody + timestamp).digest('hex')
  try {
    const a = Buffer.from(computed, 'hex')
    const b = Buffer.from(providedDigest, 'hex')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function emptyContext(): Record<string, string> {
  return {
    practice_id: '',
    practice_name: '',
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
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-retell-signature')

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const sigOk = verifySignature(rawBody, signature)
  if (!sigOk) {
    await auditSystemEvent({
      action: 'retell.inbound_webhook.unverified_signature',
      severity: 'warning',
      details: { event: body?.event ?? null },
    })
    // Continue — log + serve. Tighten to 401 once webhook badge confirmed.
  }

  const inbound = body?.call_inbound ?? {}
  const fromNumber: string = inbound.from_number ?? ''
  const toNumber: string = inbound.to_number ?? ''

  const ctx = emptyContext()

  // Resolve practice from to_number
  let practice: any = null
  try {
    const { rows } = await pool.query(
      `SELECT id, name, owner_email
         FROM practices
        WHERE signalwire_number = $1 OR twilio_phone_number = $1 OR phone = $1
        LIMIT 1`,
      [toNumber],
    )
    practice = rows[0] ?? null
  } catch (err) {
    console.error('[retell/inbound-webhook] practice lookup failed:', (err as Error).message)
  }

  if (practice) {
    ctx.practice_id = practice.id
    ctx.practice_name = practice.name || ''
    // Look up therapist name (if practice has primary therapist)
    try {
      const { rows: tRows } = await pool.query(
        `SELECT first_name, last_name
           FROM therapists
          WHERE practice_id = $1 AND is_primary = true
          ORDER BY created_at ASC LIMIT 1`,
        [practice.id],
      )
      const t = tRows[0]
      if (t) ctx.therapist_name = [t.first_name, t.last_name].filter(Boolean).join(' ')
    } catch {}
  }

  // Resolve caller (existing patient lookup) by from_number's last 10 digits
  if (practice && fromNumber) {
    const normalizedFrom = fromNumber.replace(/\D/g, '').slice(-10)
    if (normalizedFrom.length >= 10) {
      try {
        const { rows: pRows } = await pool.query(
          `SELECT first_name, last_name, billing_mode, intake_completed,
                  insurance_provider
             FROM patients
            WHERE practice_id = $1 AND phone ILIKE $2 AND deleted_at IS NULL
            ORDER BY created_at DESC LIMIT 1`,
          [practice.id, `%${normalizedFrom}`],
        )
        const p = pRows[0]
        if (p) {
          ctx.caller_is_existing_patient = 'yes'
          ctx.caller_first_name = p.first_name || ''
          ctx.caller_last_name = p.last_name || ''
          ctx.caller_billing_mode = p.billing_mode || ''
          ctx.caller_intake_completed = p.intake_completed ? 'yes' : 'no'
          ctx.caller_insurance_provider = p.insurance_provider || ''
        }
      } catch {}
    }
  }

  await auditSystemEvent({
    action: 'retell.inbound_webhook.responded',
    severity: 'info',
    practiceId: practice?.id ?? null,
    details: {
      from_number: fromNumber,
      to_number: toNumber,
      practice_resolved: !!practice,
      caller_is_existing: ctx.caller_is_existing_patient === 'yes',
    },
  })

  return NextResponse.json({
    call_inbound: {
      dynamic_variables: ctx,
      metadata: {
        practice_id: ctx.practice_id || '',
        from_number: fromNumber,
        to_number: toNumber,
      },
    },
  })
}
