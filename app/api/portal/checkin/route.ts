// app/api/portal/checkin/route.ts
//
// W46 T5 — patient portal daily check-in.
//   GET  → today's check-in row if it exists (so the portal home can
//          decide whether to show the prompt).
//   POST → upsert today's check-in. mood_score required. symptoms +
//          note optional. Writes a W45 daily_checkin_completed signal
//          on success so the engagement heuristic picks it up.
//   DELETE → opt out of reminders permanently for this patient.

import { NextResponse, type NextRequest } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROMPTED_VIA = new Set(['portal_visit', 'sms', 'email', 'manual'])

export async function GET() {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const { rows } = await pool.query(
    `SELECT id, mood_score, symptoms, note, prompted_via, created_at
       FROM ehr_daily_checkins
      WHERE practice_id = $1 AND patient_id = $2
        AND (created_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date
      LIMIT 1`,
    [sess.practiceId, sess.patientId],
  )

  // Also surface the patient's reminder preference so the portal can
  // toggle the UI accordingly.
  const pr = await pool.query(
    `SELECT daily_checkin_reminder_enabled, daily_checkin_reminder_local_time
       FROM patients WHERE id = $1 LIMIT 1`,
    [sess.patientId],
  )

  return NextResponse.json({
    today: rows[0] || null,
    reminder_enabled: pr.rows[0]?.daily_checkin_reminder_enabled ?? false,
    reminder_local_time: pr.rows[0]?.daily_checkin_reminder_local_time ?? null,
  })
}

export async function POST(req: NextRequest) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const moodScore = Number(body.mood_score)
  if (!Number.isInteger(moodScore) || moodScore < 1 || moodScore > 5) {
    return NextResponse.json({ error: 'mood_score must be 1..5' }, { status: 400 })
  }

  const symptomsRaw = Array.isArray(body.symptoms) ? body.symptoms : []
  const symptoms = symptomsRaw
    .map((s: any) => String(s).trim())
    .filter((s: string) => s.length > 0 && s.length <= 64)
    .slice(0, 12)

  const note = body.note ? String(body.note).slice(0, 500) : null
  const promptedVia = PROMPTED_VIA.has(body.prompted_via) ? body.prompted_via : 'portal_visit'

  // Upsert by (practice, patient, day). The unique index is on
  // ((created_at AT TIME ZONE 'UTC')::date) so we use the same shape
  // in the conflict target.
  const ins = await pool.query(
    `INSERT INTO ehr_daily_checkins
       (practice_id, patient_id, mood_score, symptoms, note, prompted_via)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (practice_id, patient_id, ((created_at AT TIME ZONE 'UTC')::date))
       DO UPDATE
         SET mood_score = EXCLUDED.mood_score,
             symptoms   = EXCLUDED.symptoms,
             note       = EXCLUDED.note,
             prompted_via = EXCLUDED.prompted_via
     RETURNING id, mood_score, symptoms, note, prompted_via, created_at`,
    [sess.practiceId, sess.patientId, moodScore, symptoms, note, promptedVia],
  )

  // Feed W45 engagement signal — same idempotency rules apply (UTC day
  // bucket via observed_at truncated). Best-effort.
  try {
    await pool.query(
      `INSERT INTO ehr_patient_signals
         (practice_id, patient_id, signal_kind, value, observed_at, source)
       VALUES ($1, $2, 'daily_checkin_completed', $3::jsonb, NOW(), 'portal_checkin')
       ON CONFLICT (practice_id, patient_id, signal_kind, observed_at, source)
         DO NOTHING`,
      [sess.practiceId, sess.patientId, JSON.stringify({ mood_score: moodScore, symptom_count: symptoms.length })],
    )
  } catch {
    // signal write is best-effort
  }

  await auditPortalAccess({
    session: sess,
    action: 'portal.checkin.completed',
    resourceType: 'ehr_daily_checkin',
    resourceId: ins.rows[0].id,
    details: { mood_score: moodScore, symptom_count: symptoms.length, has_note: !!note },
  })

  return NextResponse.json({ checkin: ins.rows[0] })
}

export async function DELETE() {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  await pool.query(
    `UPDATE patients
        SET daily_checkin_reminder_enabled = FALSE,
            daily_checkin_reminder_local_time = NULL
      WHERE id = $1 AND practice_id = $2`,
    [sess.patientId, sess.practiceId],
  )

  await auditPortalAccess({
    session: sess,
    action: 'portal.checkin.reminder_opted_out',
    resourceType: 'patient',
    details: {},
  })

  return NextResponse.json({ ok: true })
}
