// app/api/chime/recording-webhook/route.ts
//
// Wave 43 / T0 — receive Chime Media Pipelines lifecycle events
// and update ehr_telehealth_recordings.status atomically. HMAC-
// verified at the route level (in PUBLIC_API_PREFIXES so the
// middleware doesn't gate on Cognito).

import { NextResponse, type NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function verifyHmac(body: string, sigHeader: string | null): boolean {
  const secret = process.env.CHIME_WEBHOOK_SECRET
  if (!secret || !sigHeader) return false
  let candidate = sigHeader
  const m = sigHeader.match(/v1=([0-9a-f]+)/i)
  if (m) candidate = m[1]
  const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  if (candidate.length !== expected.length) return false
  try { return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(expected, 'hex')) }
  catch { return false }
}

function mapStatus(state: string | undefined): string | null {
  if (!state) return null
  const s = state.toLowerCase()
  if (s.includes('init') || s === 'inprogress' || s === 'in_progress') return 'recording'
  if (s.includes('paus')) return 'recording'
  if (s.includes('stopping') || s.includes('stop_in_progress')) return 'stopping'
  if (s.includes('completed') || s === 'stopped' || s === 'success') return 'available'
  if (s.includes('fail') || s === 'error' || s === 'failed') return 'error'
  return null
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const sig =
    req.headers.get('chime-signature') ||
    req.headers.get('x-chime-signature') ||
    req.headers.get('x-amz-event-signature')

  if (!verifyHmac(raw, sig)) {
    await auditSystemEvent({
      action: 'chime.recording_webhook.received',
      severity: 'warning',
      details: { outcome: 'signature_invalid_or_secret_missing' },
    })
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let payload: any
  try { payload = JSON.parse(raw) }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const detail = payload.detail ?? payload
  const pipelineId =
    detail?.MediaPipelineId ?? detail?.mediaPipelineId ?? detail?.pipeline_id ?? null
  const stateRaw =
    detail?.Status ?? detail?.status ?? detail?.state ?? detail?.NewStatus ?? null
  const errorMessage =
    detail?.ErrorMessage ?? detail?.errorMessage ?? null

  if (!pipelineId) {
    await auditSystemEvent({
      action: 'chime.recording_webhook.received',
      severity: 'warning',
      details: { outcome: 'no_pipeline_id_in_payload' },
    })
    return NextResponse.json({ error: 'no pipeline_id' }, { status: 400 })
  }

  const newStatus = mapStatus(stateRaw)
  const cur = await pool.query(
    `SELECT id, practice_id, status FROM ehr_telehealth_recordings
      WHERE chime_pipeline_id = $1 LIMIT 1`,
    [pipelineId],
  )
  if (cur.rows.length === 0) {
    await auditSystemEvent({
      action: 'chime.recording_webhook.received',
      severity: 'warning',
      details: { outcome: 'no_matching_recording', pipeline_id: pipelineId, state: stateRaw },
    })
    return NextResponse.json({ ok: true, matched: false })
  }
  const row = cur.rows[0]

  // Forward-only state advancement.
  if (newStatus && newStatus !== row.status) {
    const advanceOk =
      (row.status === 'starting' && (newStatus === 'recording' || newStatus === 'error')) ||
      (row.status === 'recording' && (newStatus === 'stopping' || newStatus === 'available' || newStatus === 'error')) ||
      (row.status === 'stopping' && (newStatus === 'available' || newStatus === 'error'))

    if (advanceOk) {
      await pool.query(
        `UPDATE ehr_telehealth_recordings
            SET status = $1, error_reason = COALESCE($2, error_reason)
          WHERE id = $3`,
        [newStatus, errorMessage, row.id],
      )
    }
  }

  await auditSystemEvent({
    action: 'chime.recording_webhook.received',
    severity: 'info',
    practiceId: row.practice_id,
    resourceType: 'ehr_telehealth_recording',
    resourceId: row.id,
    details: {
      pipeline_id: pipelineId,
      chime_state: stateRaw,
      mapped_status: newStatus,
      prior_status: row.status,
    },
  })

  return NextResponse.json({ ok: true, matched: true })
}
