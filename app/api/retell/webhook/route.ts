// app/api/retell/webhook/route.ts
//
// Wave 28 — Retell call-lifecycle webhook. Handles call_started,
// call_ended, and call_analyzed events. Persists into call_logs +
// audit_logs.
//
// Wave 41 T5 — hardened signature verification, agent-id check, and
// degraded-schema fallback path on call_logs INSERT.
//
// Wave 45 — call-transcript SIGNAL extraction layer (Harbor's unique
// predictive moat: only Harbor has fully-transcribed AI-receptionist
// calls; competitor EHRs cannot replicate this). On call_ended /
// call_analyzed we run lib/aws/retell/extract-signals.ts, persist the
// derived columns back into call_logs, write rows into the broader
// ehr_patient_signals table (owned by the parallel branch — guarded
// with try/catch so migration order is safe), and on crisis_risk=true
// route the existing W37 crisis-handoff path: critical-severity audit,
// SignalWire SMS to the therapist, crisis_alerts row for the Today
// screen Needs-Attention block. NEVER messages the patient. NEVER
// auto-takes clinical action.
//
// Auth: Retell signs each webhook with HMAC-SHA256 over (rawBody +
// timestamp), keyed with a webhook-enabled API key. Header is
// x-retell-signature in format "v={timestamp},d={hex_digest}".
// (https://docs.retellai.com/features/secure-webhook)

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent, RETELL_SIGNAL_AUDIT_ACTIONS } from '@/lib/aws/ehr/audit'
import { extractSignals, type ExtractedSignals } from '@/lib/aws/retell/extract-signals'
import { sendSMS } from '@/lib/aws/signalwire'

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

interface PatientLookup {
  patientId: string | null
  firstName: string | null
}

async function resolvePatient(
  practiceId: string | null,
  fromNumber: string | null,
): Promise<PatientLookup> {
  if (!practiceId || !fromNumber) return { patientId: null, firstName: null }
  // Mirror app/api/retell/inbound-webhook/route.ts: match on last 10 digits
  // via ILIKE — handles +1, formatting variants, and stored normalisations.
  const normalised = fromNumber.replace(/\D/g, '').slice(-10)
  if (normalised.length < 10) return { patientId: null, firstName: null }
  try {
    const { rows } = await pool.query(
      `SELECT id, first_name FROM patients
        WHERE practice_id = $1
          AND phone ILIKE $2
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [practiceId, `%${normalised}`],
    )
    if (rows[0]) return { patientId: rows[0].id, firstName: rows[0].first_name ?? null }
  } catch {
    /* fall through */
  }
  return { patientId: null, firstName: null }
}

interface PracticeAlertContext {
  alertPhone: string | null
  practiceName: string | null
}

async function loadPracticeAlertContext(practiceId: string | null): Promise<PracticeAlertContext> {
  if (!practiceId) return { alertPhone: null, practiceName: null }
  try {
    const { rows } = await pool.query(
      `SELECT name, therapist_phone, owner_phone
         FROM practices WHERE id = $1 LIMIT 1`,
      [practiceId],
    )
    const r = rows[0]
    if (!r) return { alertPhone: null, practiceName: null }
    return {
      alertPhone: r.therapist_phone || r.owner_phone || null,
      practiceName: r.name ?? null,
    }
  } catch {
    return { alertPhone: null, practiceName: null }
  }
}

/**
 * Persist extracted signals back to call_logs columns (Wave 45 schema)
 * and append rows into ehr_patient_signals (broader Wave 45 surface,
 * T1 — owned by parallel branch). Both writes are best-effort; either
 * may fail with "column does not exist" / "relation does not exist"
 * during migration windows and we explicitly do NOT block the webhook.
 */
async function persistSignals(args: {
  callId: string | null
  practiceId: string | null
  patientId: string | null
  signals: ExtractedSignals
}): Promise<void> {
  const { callId, practiceId, patientId, signals } = args
  if (!callId) return

  // 1) call_logs columns
  try {
    await pool.query(
      `UPDATE call_logs
          SET inferred_no_show_intent    = $2,
              inferred_reschedule_intent = $3,
              inferred_crisis_risk       = $4,
              caller_sentiment_score     = $5,
              hesitation_markers         = $6::jsonb,
              extracted_signals          = $7::jsonb,
              signals_extracted_at       = NOW(),
              crisis_detected            = call_logs.crisis_detected OR $4
        WHERE retell_call_id = $1`,
      [
        callId,
        signals.no_show_intent,
        signals.reschedule_intent,
        signals.crisis_risk,
        signals.sentiment_score,
        JSON.stringify({ count: signals.hesitation_count ?? 0, markers: signals.hesitation_markers }),
        JSON.stringify(signals),
      ],
    )
  } catch (err) {
    // Migration not applied yet, or call_logs lacks retell_call_id —
    // both acceptable degraded states. Logged but not blocking.
    console.error('[retell/webhook] call_logs signal update failed:', (err as Error).message)
  }

  // 2) ehr_patient_signals — written conditionally. The full table +
  // schema is Wave 45 T1 on the parallel branch. We try/catch so
  // either ordering of merges is safe; once T1 lands, these rows
  // start appearing automatically.
  if (!practiceId || !patientId) return
  const rows: Array<{ kind: string; value: unknown }> = [
    { kind: 'call_received', value: { call_id: callId } },
    { kind: 'call_no_show_intent', value: signals.no_show_intent },
    { kind: 'call_reschedule_intent', value: signals.reschedule_intent },
    { kind: 'call_crisis_risk', value: signals.crisis_risk },
    { kind: 'call_sentiment', value: signals.sentiment_score },
  ]
  for (const r of rows) {
    if (r.kind !== 'call_received' && (r.value === null || r.value === false)) continue
    try {
      await pool.query(
        `INSERT INTO ehr_patient_signals
            (practice_id, patient_id, kind, value, source, source_ref, observed_at)
          VALUES ($1, $2, $3, $4::jsonb, 'retell_webhook', $5, NOW())`,
        [practiceId, patientId, r.kind, JSON.stringify(r.value), callId],
      )
    } catch {
      /* table not yet present — silent. */
    }
  }
}

/**
 * Crisis handoff. Mirrors the W37 path used by /api/crisis (Tier 1
 * detection): SMS the therapist, log a crisis_alerts row for the
 * Today-screen Needs-Attention block, and emit a critical-severity
 * audit. NEVER messages the patient. NEVER takes clinical action.
 */
async function handleCrisis(args: {
  callId: string
  practiceId: string | null
  patientId: string | null
  signals: ExtractedSignals
}): Promise<void> {
  const { callId, practiceId, patientId, signals } = args

  // Critical audit — PHI-safe payload (no name, no phone, no transcript).
  await auditSystemEvent({
    action: RETELL_SIGNAL_AUDIT_ACTIONS.CRISIS_FLAGGED,
    severity: 'critical',
    practiceId,
    resourceType: 'call_log',
    resourceId: callId,
    details: {
      call_id: callId,
      patient_id: patientId,
      source: signals.source,
      ai_used: signals.ai_used,
      key_phrase_count: signals.key_phrases.length,
    },
  })

  if (!practiceId) return
  const ctx = await loadPracticeAlertContext(practiceId)

  // crisis_alerts row — surfaces on the Today screen until a therapist
  // marks reviewed=true. Existing W37 table; we do NOT add a new
  // patient-level flag column to keep this PR light-touch.
  try {
    await pool.query(
      `INSERT INTO crisis_alerts
          (practice_id, call_log_id, patient_phone, sms_sent, keywords_found)
        VALUES (
          $1,
          (SELECT id FROM call_logs WHERE retell_call_id = $2 LIMIT 1),
          NULL,
          false,
          $3::text[]
        )`,
      [practiceId, callId, signals.key_phrases.slice(0, 8)],
    )
  } catch (err) {
    console.error('[retell/webhook] crisis_alerts insert failed:', (err as Error).message)
  }

  if (!ctx.alertPhone) return

  // Therapist SMS. Patient name is intentionally OMITTED here — the
  // SMS travels over a third-party network and PHI minimisation
  // dictates a generic message + a deep link. The therapist gets full
  // context once they open the patient page.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://app.harbor.health'
  const patientUrl = patientId ? `${baseUrl}/patients/${patientId}` : `${baseUrl}/dashboard`
  const body = [
    'Harbor crisis-handoff alert.',
    'A receptionist call from your practice surfaced conversational',
    'signals consistent with possible crisis. Therapist review needed.',
    `Open: ${patientUrl}`,
    'If immediate danger, call 911. 988 Suicide & Crisis Lifeline.',
  ].join(' ')
  try {
    const r = await sendSMS({
      to: ctx.alertPhone,
      body,
      practiceId,
    })
    if (r.ok) {
      await pool
        .query(
          `UPDATE crisis_alerts
              SET sms_sent = true
            WHERE practice_id = $1
              AND call_log_id = (SELECT id FROM call_logs WHERE retell_call_id = $2 LIMIT 1)`,
          [practiceId, callId],
        )
        .catch(() => {})
    }
  } catch (err) {
    console.error('[retell/webhook] crisis SMS failed:', (err as Error).message)
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

      // ---- Wave 45: signal extraction ----------------------------------
      // Run on either event when we have a transcript. The extractor
      // caches by call_id, so call_ended → call_analyzed never double
      // spends Bedrock. The two layers (regex + AI) both run; failures
      // degrade to regex-only inside the extractor.
      if (transcript && transcript.trim().length >= 10 && callId) {
        const patient = await resolvePatient(practiceId, fromNumber)
        let signals: ExtractedSignals | null = null
        try {
          signals = await extractSignals({
            callId,
            transcript,
            callAnalysis: call?.call_analysis ?? null,
            patientFirstName: patient.firstName,
          })
        } catch (err) {
          console.error('[retell/webhook] extractSignals failed:', (err as Error).message)
        }
        if (signals) {
          await persistSignals({
            callId,
            practiceId,
            patientId: patient.patientId,
            signals,
          })

          await auditSystemEvent({
            action: RETELL_SIGNAL_AUDIT_ACTIONS.EXTRACTED,
            severity: 'info',
            practiceId,
            resourceType: 'call_log',
            resourceId: callId,
            details: {
              call_id: callId,
              patient_id: patient.patientId,
              source: signals.source,
              ai_used: signals.ai_used,
              fallback_reason: signals.fallback_reason ?? null,
              no_show_intent: signals.no_show_intent,
              reschedule_intent: signals.reschedule_intent,
              crisis_risk: signals.crisis_risk,
              sentiment_score: signals.sentiment_score,
              hesitation_count: signals.hesitation_count,
              key_phrase_count: signals.key_phrases.length,
              confidence: signals.confidence,
              // PHI rule (Wave 41 T0): no patient names / phone numbers /
              // transcript content in details.
            },
          })

          if (signals.crisis_risk === true) {
            await handleCrisis({
              callId,
              practiceId,
              patientId: patient.patientId,
              signals,
            })
          }
        }
      }
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
