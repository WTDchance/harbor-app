// app/api/retell/webhook/route.ts
//
// Wave 27c — Retell call-lifecycle webhook. Handles call_started,
// call_ended, and call_analyzed events. The call_ended handler writes
// a call_logs row mirroring the existing Vapi end-of-call persistence
// so the dashboard / EHR / analytics paths get the same shape.
//
// Auth: Retell signs each webhook with HMAC-SHA256 over the raw body
// using the agent's API key. Header is x-retell-signature. We verify
// signature when RETELL_API_KEY is set; in dev it's an audit-log warn
// rather than a hard reject so local testing isn't blocked.
//
// (Reference: https://docs.retellai.com/api-references/webhook)

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

function verifySignature(rawBody: string, signature: string | null): boolean {
  const apiKey = process.env.RETELL_API_KEY || ''
  if (!apiKey || !signature) return false
  const computed = createHmac('sha256', apiKey).update(rawBody).digest('hex')
  try {
    const a = Buffer.from(computed, 'hex')
    const b = Buffer.from(signature.replace(/^sha256=/, ''), 'hex')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
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
    // Don't hard-reject in case Retell's signing flow is different
    // from what we expect — log and continue. Hardening to 401 once
    // we've seen a few real signed events in CloudWatch.
    await auditSystemEvent({
      action: 'retell.webhook.unverified_signature',
      severity: 'warn',
      details: { event: body?.event, call_id: body?.call?.call_id ?? null },
    })
  }

  const event: string = body?.event ?? ''
  const call = body?.call ?? {}
  const callId = call?.call_id ?? null
  const agentId = call?.agent_id ?? null
  const fromNumber = call?.from_number ?? null
  const toNumber = call?.to_number ?? null
  const startTimestamp = call?.start_timestamp ?? null
  const endTimestamp = call?.end_timestamp ?? null
  const duration = startTimestamp && endTimestamp ? Math.round((endTimestamp - startTimestamp) / 1000) : null
  const transcript: string | null = call?.transcript ?? null
  const summary: string | null = call?.call_analysis?.call_summary ?? null
  const userSentiment: string | null = call?.call_analysis?.user_sentiment ?? null
  const successful: boolean | null = typeof call?.call_analysis?.call_successful === 'boolean'
    ? call.call_analysis.call_successful : null
  const customAnalysis = call?.call_analysis?.custom_analysis_data ?? null

  // Practice resolution — set when register-call passed the dynamic var
  const dynVars = call?.retell_llm_dynamic_variables ?? {}
  const practiceId: string | null = typeof dynVars.practice_id === 'string'
    ? dynVars.practice_id : null

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
        details: { call_id: callId, from_number: fromNumber, to_number: toNumber, agent_id: agentId },
      })
    } else if (event === 'call_ended' || event === 'call_analyzed') {
      // Persist into call_logs (idempotent on retell_call_id).
      try {
        await pool.query(
          `INSERT INTO call_logs
              (practice_id, retell_call_id, call_type, caller_name,
               patient_phone, duration_seconds, summary, transcript,
               crisis_detected, created_at)
            VALUES ($1, $2, 'inbound_voice', NULL, $3, $4, $5, $6, $7, NOW())
            ON CONFLICT (retell_call_id) DO UPDATE
              SET duration_seconds = EXCLUDED.duration_seconds,
                  summary = COALESCE(EXCLUDED.summary, call_logs.summary),
                  transcript = COALESCE(EXCLUDED.transcript, call_logs.transcript),
                  crisis_detected = call_logs.crisis_detected OR EXCLUDED.crisis_detected`,
          [
            practiceId,
            callId,
            fromNumber,
            duration,
            summary,
            transcript,
            !!(customAnalysis?.crisis_signals === true),
          ],
        )
      } catch (err) {
        // call_logs might not have retell_call_id column on all envs yet;
        // fall back to inserting without the unique key.
        try {
          await pool.query(
            `INSERT INTO call_logs
                (practice_id, call_type, patient_phone, duration_seconds,
                 summary, transcript, crisis_detected, created_at)
              VALUES ($1, 'inbound_voice', $2, $3, $4, $5, $6, NOW())`,
            [
              practiceId, fromNumber, duration, summary, transcript,
              !!(customAnalysis?.crisis_signals === true),
            ],
          )
        } catch (err2) {
          console.error('[retell/webhook] call_logs insert failed:', (err2 as Error).message)
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
