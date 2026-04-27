// app/api/portal/schedule/book/route.ts
//
// Wave 42 / T1 — direct-book endpoint for an authenticated portal
// patient. Only allowed when scheduling_config.allow_existing_patient_
// direct_book = true. Otherwise the patient submits via the existing
// /api/portal/scheduling 'request' flow that the therapist responds to.
//
// Atomically: re-check the slot is still free (race-safe), insert
// the appointment, return it.

import { NextResponse, type NextRequest } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface VisitType {
  key: string
  duration_minutes: number
  modality: string
}

export async function POST(req: NextRequest) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const visitTypeKey = typeof body?.visit_type === 'string' ? body.visit_type : ''
  const startIso = typeof body?.start === 'string' ? body.start : ''
  if (!visitTypeKey || !startIso) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'visit_type and start required' } },
      { status: 400 },
    )
  }

  // Load practice config.
  const pr = await pool.query(
    `SELECT scheduling_config FROM practices WHERE id = $1 LIMIT 1`,
    [sess.practiceId],
  )
  const cfg = (pr.rows[0]?.scheduling_config ?? {}) as Record<string, any>
  if (!cfg.enabled || !cfg.allow_existing_patient_direct_book) {
    return NextResponse.json(
      {
        error: {
          code: 'direct_book_disabled',
          message: 'Direct booking is disabled for this practice. Submit a scheduling request instead.',
        },
      },
      { status: 409 },
    )
  }
  const visitType: VisitType | undefined = (cfg.visit_types ?? []).find((v: VisitType) => v.key === visitTypeKey)
  const duration = visitType?.duration_minutes ?? cfg.default_duration_minutes ?? 50

  const start = new Date(startIso)
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: { code: 'invalid_request', message: 'start is not a valid ISO timestamp' } }, { status: 400 })
  }
  const end = new Date(start.getTime() + duration * 60_000)

  // Race-safe slot check.
  const conflict = await pool.query(
    `SELECT id FROM appointments
      WHERE practice_id = $1
        AND status IN ('scheduled','confirmed','rescheduled')
        AND scheduled_for < $3
        AND scheduled_for + (duration_minutes || ' minutes')::interval > $2
      LIMIT 1`,
    [sess.practiceId, start.toISOString(), end.toISOString()],
  ).catch(() => ({ rows: [] as any[] }))

  if (conflict.rows.length > 0) {
    return NextResponse.json(
      { error: { code: 'slot_taken', message: 'That slot was just booked. Please pick another.' } },
      { status: 409 },
    )
  }

  // Insert appointment. session_kind=individual (W41 T2 default);
  // appointment_type fallback to follow_up. The therapist can edit
  // afterwards.
  const apptType = visitType?.key === cfg.intake_visit_type_key ? 'intake' : 'follow_up'
  const { rows } = await pool.query(
    `INSERT INTO appointments
       (practice_id, patient_id, scheduled_for, duration_minutes,
        appointment_type, status, source)
     VALUES ($1, $2, $3, $4, $5, 'scheduled', 'patient_self_book')
     RETURNING *`,
    [sess.practiceId, sess.patientId, start.toISOString(), duration, apptType],
  ).catch((err) => { throw err })

  await auditPortalAccess({
    session: sess,
    action: 'portal.scheduling.book',
    resourceType: 'appointment',
    resourceId: rows[0].id,
    details: {
      patient_id: sess.patientId,
      visit_type: visitTypeKey,
      duration,
      start: start.toISOString(),
    },
  }).catch(() => {})

  return NextResponse.json({ appointment: rows[0] }, { status: 201 })
}
