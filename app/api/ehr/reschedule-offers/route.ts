// app/api/ehr/reschedule-offers/route.ts
//
// W45 T4 — record a reschedule offer being sent and (later) accepted /
// declined. Writes a row to ehr_patient_signals so the rescheduler
// learns from outcomes — closed-loop ML training data for W46+.
//
// POST body shapes:
//   { kind: 'sent',     patient_id, appointment_id, channel }
//   { kind: 'accepted', patient_id, appointment_id }
//   { kind: 'declined', patient_id, appointment_id, reason? }

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KIND_TO_SIGNAL: Record<string, string> = {
  sent:     'reschedule_offer_sent',
  accepted: 'reschedule_offer_accepted',
  declined: 'reschedule_offer_declined',
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const kind = String(body.kind || '')
  const patientId = String(body.patient_id || '')
  const apptId = body.appointment_id ? String(body.appointment_id) : null
  if (!KIND_TO_SIGNAL[kind] || !patientId) {
    return NextResponse.json({ error: 'kind and patient_id required' }, { status: 400 })
  }

  const value: Record<string, unknown> = { offer_appointment_id: apptId }
  if (body.channel) value.channel = String(body.channel)
  if (body.reason) value.reason = String(body.reason).slice(0, 200)

  await pool.query(
    `INSERT INTO ehr_patient_signals
       (practice_id, patient_id, signal_kind, value, observed_at, source)
     VALUES ($1, $2, $3, $4::jsonb, NOW(), 'reschedule_offer')
     ON CONFLICT (practice_id, patient_id, signal_kind, observed_at, source)
       DO NOTHING`,
    [ctx.practiceId, patientId, KIND_TO_SIGNAL[kind], JSON.stringify(value)],
  )

  return NextResponse.json({ ok: true })
}
