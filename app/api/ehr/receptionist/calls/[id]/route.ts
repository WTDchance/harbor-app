// app/api/ehr/receptionist/calls/[id]/route.ts
//
// W50 D5 — single-call detail. Returns full transcript, capture panel,
// signals, recording URL, and corrections so far.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const callRow = await pool.query(
    `SELECT id, created_at, from_number, to_number, duration_seconds, summary,
            transcript, recording_url, patient_id::text, retell_call_id,
            inferred_crisis_risk, inferred_no_show_intent, inferred_reschedule_intent,
            caller_sentiment_score, hesitation_markers, extracted_signals
       FROM call_logs
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, ctx.practiceId],
  ).catch(() => ({ rows: [] as any[] }))

  if (callRow.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const call = callRow.rows[0]

  const signalsRow = await pool.query(
    `SELECT id, signal_type, signal_value, confidence, raw_excerpt, extracted_by, extracted_at
       FROM ehr_call_signals
      WHERE practice_id = $1 AND call_id = $2
      ORDER BY extracted_at ASC`,
    [ctx.practiceId, id],
  ).catch(() => ({ rows: [] as any[] }))

  const corrRow = await pool.query(
    `SELECT id, field_name, original_value, corrected_value, corrected_at, corrected_by_user_id::text, notes
       FROM receptionist_corrections
      WHERE practice_id = $1 AND call_id = $2
      ORDER BY corrected_at DESC`,
    [ctx.practiceId, id],
  ).catch(() => ({ rows: [] as any[] }))

  // Build the captured-data panel from signals + linked patient.
  const captures: Record<string, { value: string; confidence: number | null; source: string }> = {}
  for (const s of signalsRow.rows) {
    let key: string | null = null
    if (s.signal_type === 'name_candidate')      key = 'patient_name'
    else if (s.signal_type === 'dob_candidate')  key = 'patient_dob'
    else if (s.signal_type === 'phone_confirmation') key = 'patient_phone'
    else if (s.signal_type === 'insurance_mention')  key = 'insurance_carrier'
    if (!key) continue
    const conf = Number(s.confidence) || 0
    if (!captures[key] || conf > captures[key].confidence!) {
      captures[key] = { value: s.signal_value, confidence: conf, source: s.extracted_by }
    }
  }

  await auditEhrAccess({
    ctx,
    action: 'receptionist.calls.view',
    resourceType: 'call_log',
    resourceId: id,
  })

  return NextResponse.json({
    call,
    signals: signalsRow.rows,
    captures,
    corrections: corrRow.rows,
  })
}
