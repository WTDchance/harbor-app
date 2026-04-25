// Cron — assessment schedule tick.
// Runs every ~15 min via cron-job.org. Bearer ${CRON_SECRET}.
//
// Walks ehr_assessment_schedules (is_active=true, next_due_at <= now),
// creates a pending row in patient_assessments for each, and bumps
// next_due_at by cadence_weeks. Skips schedules where a pending row of
// the same (patient_id, assessment_type) already exists, but still bumps
// next_due_at so the tick doesn't loop forever.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { getInstrument } from '@/lib/ehr/instruments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 14

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const nowIso = new Date().toISOString()

  let due: any[] = []
  try {
    const dueResult = await pool.query(
      `SELECT id, practice_id, patient_id, assessment_type, cadence_weeks, next_due_at
         FROM ehr_assessment_schedules
        WHERE is_active = true
          AND next_due_at <= $1
        ORDER BY next_due_at ASC
        LIMIT 200`,
      [nowIso],
    )
    due = dueResult.rows
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    )
  }

  type Outcome = { schedule_id: string; status: 'created' | 'skipped'; reason?: string }
  const results: Outcome[] = []

  for (const s of due) {
    const inst = getInstrument(s.assessment_type)
    if (!inst) {
      results.push({ schedule_id: s.id, status: 'skipped', reason: 'unknown instrument' })
      continue
    }

    // Bump value applied to next_due_at on both the create and skipped paths.
    const bumpIso = new Date(Date.now() + s.cadence_weeks * 7 * 24 * 60 * 60 * 1000).toISOString()

    // Skip if a pending assessment already exists for this patient + type.
    const existingPending = await pool.query(
      `SELECT id FROM patient_assessments
        WHERE patient_id = $1
          AND assessment_type = $2
          AND status = 'pending'
        LIMIT 1`,
      [s.patient_id, s.assessment_type],
    ).catch(() => ({ rows: [] as any[] }))

    if (existingPending.rows[0]) {
      await pool.query(
        `UPDATE ehr_assessment_schedules
            SET next_due_at = $1
          WHERE id = $2`,
        [bumpIso, s.id],
      ).catch(() => {})
      results.push({ schedule_id: s.id, status: 'skipped', reason: 'pending exists' })
      continue
    }

    const expires = new Date(Date.now() + WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const patientResult = await pool.query(
      `SELECT first_name, last_name FROM patients WHERE id = $1 LIMIT 1`,
      [s.patient_id],
    ).catch(() => ({ rows: [] as any[] }))
    const patient = patientResult.rows[0]
    const patientName = patient
      ? `${patient.first_name ?? ''} ${patient.last_name ?? ''}`.trim() || null
      : null

    await pool.query(
      `INSERT INTO patient_assessments (
         practice_id, patient_id, patient_name, assessment_type,
         status, administered_via, assigned_at, expires_at
       ) VALUES (
         $1, $2, $3, $4, 'pending', 'portal', $5, $6
       )`,
      [s.practice_id, s.patient_id, patientName, inst.id, nowIso, expires],
    ).catch(err => console.error('[cron/schedule-tick] assessment insert failed', err))

    await pool.query(
      `UPDATE ehr_assessment_schedules
          SET next_due_at = $1
        WHERE id = $2`,
      [bumpIso, s.id],
    ).catch(() => {})

    results.push({ schedule_id: s.id, status: 'created' })
  }

  const created = results.filter(r => r.status === 'created').length
  const skipped = results.filter(r => r.status === 'skipped').length

  auditSystemEvent({
    action: 'cron.ehr-schedule-tick.run',
    details: { checked: due.length, created, skipped },
  }).catch(() => {})

  return NextResponse.json({
    checked: due.length,
    created,
    skipped,
    results,
  })
}
