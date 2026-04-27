// app/api/retell/webhook/route.ts
//
// Wave 28 — Retell call-lifecycle webhook. Handles call_started,
// call_ended, and call_analyzed events. Persists into call_logs +
// audit_logs.
//
// Auth: Retell signs each webhook with HMAC-SHA256 over (rawBody +
// timestamp), keyed with a webhook-enabled API key. Header is
// x-retell-signature in format "v={timestamp},d={hex_digest}".
// (https://docs.retellai.com/features/secure-webhook)

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
  // Replay protection: timestamp within 5 minutes
  const now = Date.now()
  const sent = parseInt(timestamp, 10)
  if (!Number.isFinite(sent)) return false
  if (Math.abs(now - sent) > 5 * 60 * 1000) return false
  // HMAC-SHA256 over rawBody + timestamp string
  const computed = createHmac('sha256', apiKey)
    .update(rawBody + timestamp)
    .digest('hex')
  try {
    const a = Buffer.from(computed, 'hex')
    const b = Buffer.from(providedDigest, 'hex')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

async function resolvePracticeId(toNumber: string | null): Promise<string | null> {
  if (!toNumber) return null
  try {
    const { rows } = await pool.query(
      `SELECT id FROM practices
        WHERE signalwire_number = $1 OR twilio_phone_number = $1 OR phone = $1
        LIMIT 1`,
      [toNumber],
    )
    return rows[0]?.id ?? null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-retell-signature')
  const expectedAgentId = process.env.RETELL_AGENT_ID || ''

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const sigOk = verifySignature(rawBody, signature)
  if (!sigOk) {
    await auditSystemEvent({
      action: 'retell.webhook.unverified_signature',
      severity: 'warn',
      details: { event: body?.event, call_id: body?.call?.call_id ?? null },
    })
    // Hard-reject on bad/missing signature. Anyone can otherwise spoof
    // call lifecycle events and forge call_logs rows.
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  const event: string = body?.event ?? ''
  const call = body?.call ?? {}
  const callId = call?.call_id ?? null
  const agentId = call?.agent_id ?? null
  const fromNumber = call?.from_number ?? null
  const toNumber = call?.to_number ?? null
  const startTimestamp = call?.start_timestamp ?? null
  const endTimestamp = call?.end_timestamp ?? null
  const duration =
    startTimestamp && endTimestamp ? Math.round((endTimestamp - startTimestamp) / 1000) : null
  const transcript: string | null = call?.transcript ?? null
  const recordingUrl: string | null = call?.recording_url ?? null
  const summary: string | null = call?.call_analysis?.call_summary ?? null
  const userSentiment: string | null = call?.call_analysis?.user_sentiment ?? null
  const successful: boolean | null =
    typeof call?.call_analysis?.call_successful === 'boolean'
      ? call.call_analysis.call_successful
      : null
  const customAnalysis = call?.call_analysis?.custom_analysis_data ?? null

  // Practice resolution: dynamic_variables first (set when inbound-webhook
  // returned context), then fall back to looking up by to_number.
  const dynVars = call?.retell_llm_dynamic_variables ?? {}
  let practiceId: string | null =
    typeof dynVars.practice_id === 'string' ? dynVars.practice_id : null
  if (!practiceId) {
    practiceId = await resolvePracticeId(toNumber)
  }

  if (expectedAgentId && agentId && agentId !== expectedAgentId) {
    await auditSystemEvent({
      action: 'retell.webhook.unknown_agent',
      severity: 'warn',
      details: { event, agent_id: agentId, expected_agent_id: expectedAgentId },
    })
    return NextResponse.json({ ok: true, ignored: 'unknown_agent' })
  }

  try {
    if (event === 'call_started') {
      await auditSystemEvent({
        action: 'retell.call.started',
        severity: 'info',
        practiceId,
        details: {
          call_id: callId,
          from_number: fromNumber,
          to_number: toNumber,
          agent_id: agentId,
        },
      })
    } else if (event === 'call_ended' || event === 'call_analyzed') {
      // Persist into call_logs (idempotent on retell_call_id).
      // We try with retell_call_id first; if column doesn't exist, fall
      // back to no-conflict insert. Multiple events for the same call
      // (call_ended then call_analyzed ~seconds later) UPSERT cleanly.
      try {
        await pool.query(
          `INSERT INTO call_logs
              (practice_id, retell_call_id, call_type, patient_phone,
               duration_seconds, summary, transcript, recording_url,
               crisis_detected, created_at)
            VALUES ($1, $2, 'inbound_voice', $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (retell_call_id) DO UPDATE
              SET duration_seconds = COALESCE(EXCLUDED.duration_seconds, call_logs.duration_seconds),
                  summary = COALESCE(EXCLUDED.summary, call_logs.summary),
                  transcript = COALESCE(EXCLUDED.transcript, call_logs.transcript),
                  recording_url = COALESCE(EXCLUDED.recording_url, call_logs.recording_url),
                  crisis_detected = call_logs.crisis_detected OR EXCLUDED.crisis_detected`,
          [
            practiceId,
            callId,
            fromNumber,
            duration,
            summary,
            transcript,
            recordingUrl,
            !!(customAnalysis?.crisis_signals === true),
          ],
        )
      } catch (err) {
        // call_logs schema variants — degrade gracefully
        const msg = (err as Error).message
        try {
          await pool.query(
            `INSERT INTO call_logs
                (practice_id, call_type, patient_phone, duration_seconds,
                 summary, transcript, crisis_detected, created_at)
              VALUES ($1, 'inbound_voice', $2, $3, $4, $5, $6, NOW())`,
            [
              practiceId,
              fromNumber,
              duration,
              summary,
              transcript,
              !!(customAnalysis?.crisis_signals === true),
            ],
          )
        } catch (err2) {
          console.error('[retell/webhook] call_logs insert failed:', msg, '|', (err2 as Error).message)
        }
      }
      await auditSystemEvent({
        action: event === 'call_ended' ? 'retell.call.ended' : 'retell.call.analyzed',
        severity: customAnalysis?.crisis_signals ? 'warn' : 'info',
        practiceId,
        details: {
          call_id: callId,
          duration_seconds: duration,
          successful,
          user_sentiment: userSentiment,
          custom_analysis: customAnalysis,
        },
      })
    } else {
      await auditSystemEvent({
        action: 'retell.webhook.other',
        severity: 'info',
        practiceId,
        details: { event, call_id: callId },
      })
    }
  } catch (err) {
    console.error('[retell/webhook] handler error:', (err as Error).message)
  }

  return NextResponse.json({ ok: true })
}
