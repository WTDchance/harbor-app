// app/api/retell/call-ended/route.ts
//
// W50 D2 — narrow webhook endpoint that handles only the Retell
// `call_ended` event and persists the per-utterance signal stream
// into ehr_call_signals. Complements the existing /api/retell/webhook
// (which handles call_started + call_analyzed and writes the aggregate
// inferred_*_intent columns on call_logs); this endpoint exists per
// the W50 spec so the deployer can route call_ended events directly
// here without parsing.
//
// Auth: same HMAC-signed scheme as /webhook. See lib/aws/retell.

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { writeAuditLog } from '@/lib/audit'
import { extractRegexSignals, hasCrisisSignal, type ExtractedCallSignal } from '@/lib/aws/retell/extract-call-signals'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SIGNATURE_RE = /v=(\d+),d=(.+)/

function verifySignature(rawBody: string, signature: string | null): boolean {
  const apiKey = process.env.RETELL_API_KEY || ''
  if (!apiKey || !signature) return false
  const m = SIGNATURE_RE.exec(signature.trim())
  if (!m) return false
  const sent = parseInt(m[1], 10)
  if (!Number.isFinite(sent)) return false
  if (Math.abs(Date.now() - sent) > 5 * 60 * 1000) return false
  const computed = createHmac('sha256', apiKey).update(rawBody + m[1]).digest('hex')
  try {
    const a = Buffer.from(computed, 'hex')
    const b = Buffer.from(m[2], 'hex')
    return a.length === b.length && timingSafeEqual(a, b)
  } catch { return false }
}

interface RetellCallEnded {
  event: 'call_ended'
  call: {
    call_id: string
    transcript?: string | null
    duration_ms?: number
    from_number?: string | null
    to_number?: string | null
    metadata?: Record<string, unknown> | null
    call_analysis?: {
      call_summary?: string | null
      user_sentiment?: string | null
      custom_analysis_data?: Record<string, unknown> | null
    } | null
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-retell-signature')
  const devBypass = process.env.RETELL_WEBHOOK_DEV_BYPASS === '1'
  if (!devBypass && !verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  let payload: RetellCallEnded
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (payload.event !== 'call_ended') {
    return NextResponse.json({ ok: true, ignored: true })
  }

  const callId = payload.call?.call_id
  if (!callId) return NextResponse.json({ error: 'missing_call_id' }, { status: 400 })

  // Look up the call_logs row by retell_call_id (or call_id metadata).
  const lookup = await pool.query(
    `SELECT id, practice_id, patient_id
       FROM call_logs
      WHERE retell_call_id = $1 OR id::text = $1
      LIMIT 1`,
    [callId],
  ).catch(() => ({ rows: [] as any[] }))

  if (lookup.rows.length === 0) {
    // Webhook arrived before /api/retell/webhook persisted call_started; ack
    // and let the cron resync layer pick up signals from existing transcripts.
    await auditSystemEvent({
      action: 'retell.call_ended.no_call_log',
      severity: 'warning',
      details: { retell_call_id: callId },
    })
    return NextResponse.json({ ok: true, deferred: true })
  }

  const row = lookup.rows[0]
  const transcript = (payload.call.transcript ?? '').toString()
  const signals: ExtractedCallSignal[] = extractRegexSignals(transcript)

  // Persist all signals in a single multi-row INSERT.
  if (signals.length > 0) {
    const cols = ['practice_id', 'call_id', 'patient_id', 'signal_type', 'signal_value', 'confidence', 'raw_excerpt', 'extracted_by'] as const
    const values: any[] = []
    const placeholders: string[] = []
    let i = 1
    for (const s of signals) {
      placeholders.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`)
      values.push(row.practice_id, row.id, row.patient_id ?? null,
                  s.signal_type, s.signal_value, s.confidence, s.raw_excerpt, s.extracted_by)
    }
    await pool.query(
      `INSERT INTO ehr_call_signals (${cols.join(', ')}) VALUES ${placeholders.join(', ')}`,
      values,
    ).catch((e) => console.error('[call-ended] signals insert failed:', (e as Error).message))
  }

  // Crisis flag handling — critical-severity audit + alert.
  if (hasCrisisSignal(signals)) {
    await writeAuditLog({
      practice_id: row.practice_id,
      action: 'retell.call.crisis_detected',
      resource_type: 'call_log',
      resource_id: row.id,
      severity: 'critical',
      details: {
        retell_call_id: callId,
        patient_id: row.patient_id,
        signal_count: signals.filter(s => s.signal_type === 'crisis_flag').length,
      },
    })
    // Best-effort in-app notification.
    await pool.query(
      `INSERT INTO crisis_alerts (practice_id, call_log_id, patient_id, alert_kind, summary, created_at)
       VALUES ($1, $2, $3, 'call_signal_crisis_flag', $4, NOW())
       ON CONFLICT DO NOTHING`,
      [row.practice_id, row.id, row.patient_id ?? null,
       'Crisis language detected in receptionist call. Review immediately.'],
    ).catch(() => null)
  }

  return NextResponse.json({
    ok: true,
    signals_extracted: signals.length,
    crisis: hasCrisisSignal(signals),
  })
}
