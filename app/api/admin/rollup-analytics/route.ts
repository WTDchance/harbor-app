// Daily practice analytics rollup.
//
// Aggregates yesterday's call_logs / appointments / patients / intake_forms
// into one practice_analytics row per practice per day. Designed for cron
// invocation (Bearer ${CRON_SECRET}). Idempotent via UPSERT on
// (practice_id, date).
//
// AWS canonical schema notes:
//   call_logs.started_at replaces the legacy created_at filter.
//   appointments.scheduled_for replaces appointment_date.
//   appointments.status='no_show' replaces the legacy boolean no_show.
//   AWS canonical call_logs lacks is_new_patient / booking_attempted /
//   booking_succeeded / topics_discussed / sentiment_score columns —
//   derived where possible from call_type + booking_outcome, otherwise null.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

function getYesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

async function computeDailyAnalytics(practiceId: string, date: string) {
  const dayStart = `${date}T00:00:00.000Z`
  const dayEnd = `${date}T23:59:59.999Z`

  const callsRes = await pool
    .query(
      `SELECT id, duration_seconds, call_type, booking_outcome
         FROM call_logs
        WHERE practice_id = $1
          AND started_at >= $2 AND started_at <= $3`,
      [practiceId, dayStart, dayEnd],
    )
    .catch(() => ({ rows: [] as any[] }))
  const calls = callsRes.rows

  const totalCalls = calls.length
  const newPatientCalls = calls.filter(c => c.call_type === 'new_patient').length
  const returningPatientCalls = calls.filter(c => c.call_type === 'existing_patient').length
  const durations = calls.map(c => c.duration_seconds).filter((d): d is number => d != null && d > 0)
  const avgCallDuration = durations.length
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : null
  const bookingAttempted = calls.filter(c => c.booking_outcome != null).length
  const bookingSucceeded = calls.filter(c => c.booking_outcome === 'booked').length
  const bookingConversionRate = bookingAttempted > 0 ? bookingSucceeded / bookingAttempted : null

  const intakesSentRes = await pool
    .query(
      `SELECT COUNT(*)::int AS c FROM intake_forms
        WHERE practice_id = $1
          AND created_at >= $2 AND created_at <= $3`,
      [practiceId, dayStart, dayEnd],
    )
    .catch(() => ({ rows: [{ c: 0 }] }))
  const intakeSentNum = intakesSentRes.rows[0]?.c ?? 0

  const intakesCompletedRes = await pool
    .query(
      `SELECT COUNT(*)::int AS c FROM intake_forms
        WHERE practice_id = $1 AND status = 'completed'
          AND completed_at >= $2 AND completed_at <= $3`,
      [practiceId, dayStart, dayEnd],
    )
    .catch(() => ({ rows: [{ c: 0 }] }))
  const intakeCompletedNum = intakesCompletedRes.rows[0]?.c ?? 0

  const intakeCompletionRate = intakeSentNum > 0
    ? intakeCompletedNum / intakeSentNum
    : null

  const apptRes = await pool
    .query(
      `SELECT id, status FROM appointments
        WHERE practice_id = $1
          AND scheduled_for >= $2 AND scheduled_for <= $3`,
      [practiceId, dayStart, dayEnd],
    )
    .catch(() => ({ rows: [] as any[] }))
  const appts = apptRes.rows
  const totalAppointments = appts.length
  const totalNoShows = appts.filter(a => a.status === 'no_show' || a.status === 'no-show').length
  const totalCancellations = appts.filter(a => a.status === 'cancelled').length
  const noShowRate = totalAppointments > 0 ? totalNoShows / totalAppointments : null

  const newPatientsRes = await pool
    .query(
      `SELECT COUNT(*)::int AS c FROM patients
        WHERE practice_id = $1
          AND created_at >= $2 AND created_at <= $3`,
      [practiceId, dayStart, dayEnd],
    )
    .catch(() => ({ rows: [{ c: 0 }] }))
  const newPatients = newPatientsRes.rows[0]?.c ?? 0

  return {
    total_calls: totalCalls,
    new_patient_calls: newPatientCalls,
    returning_patient_calls: returningPatientCalls,
    avg_call_duration_seconds: avgCallDuration,
    avg_sentiment: null as number | null, // not on AWS canonical schema
    total_bookings: bookingSucceeded,
    booking_conversion_rate: bookingConversionRate,
    intakes_sent: intakeSentNum,
    intakes_completed: intakeCompletedNum,
    intake_completion_rate: intakeCompletionRate,
    total_appointments: totalAppointments,
    total_no_shows: totalNoShows,
    total_cancellations: totalCancellations,
    no_show_rate: noShowRate,
    new_patients: newPatients,
    topic_counts_json: {} as Record<string, number>, // not on AWS canonical schema
  }
}

async function runRollup(date: string) {
  const { rows: practices } = await pool.query(
    `SELECT id, name FROM practices`,
  )

  const results: Array<{ practice_id: string; practice_name: string; status: string }> = []

  for (const practice of practices) {
    try {
      const analytics = await computeDailyAnalytics(practice.id, date)
      // UPSERT on (practice_id, date). The practice_analytics table may not
      // exist on every cluster — wrap and degrade gracefully.
      try {
        await pool.query(
          `INSERT INTO practice_analytics (
             practice_id, date, total_calls, new_patient_calls, returning_patient_calls,
             avg_call_duration_seconds, avg_sentiment, total_bookings,
             booking_conversion_rate, intakes_sent, intakes_completed,
             intake_completion_rate, total_appointments, total_no_shows,
             total_cancellations, no_show_rate, new_patients, topic_counts_json,
             computed_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, NOW()
           )
           ON CONFLICT (practice_id, date) DO UPDATE SET
             total_calls = EXCLUDED.total_calls,
             new_patient_calls = EXCLUDED.new_patient_calls,
             returning_patient_calls = EXCLUDED.returning_patient_calls,
             avg_call_duration_seconds = EXCLUDED.avg_call_duration_seconds,
             avg_sentiment = EXCLUDED.avg_sentiment,
             total_bookings = EXCLUDED.total_bookings,
             booking_conversion_rate = EXCLUDED.booking_conversion_rate,
             intakes_sent = EXCLUDED.intakes_sent,
             intakes_completed = EXCLUDED.intakes_completed,
             intake_completion_rate = EXCLUDED.intake_completion_rate,
             total_appointments = EXCLUDED.total_appointments,
             total_no_shows = EXCLUDED.total_no_shows,
             total_cancellations = EXCLUDED.total_cancellations,
             no_show_rate = EXCLUDED.no_show_rate,
             new_patients = EXCLUDED.new_patients,
             topic_counts_json = EXCLUDED.topic_counts_json,
             computed_at = NOW()`,
          [
            practice.id, date,
            analytics.total_calls, analytics.new_patient_calls, analytics.returning_patient_calls,
            analytics.avg_call_duration_seconds, analytics.avg_sentiment, analytics.total_bookings,
            analytics.booking_conversion_rate, analytics.intakes_sent, analytics.intakes_completed,
            analytics.intake_completion_rate, analytics.total_appointments, analytics.total_no_shows,
            analytics.total_cancellations, analytics.no_show_rate, analytics.new_patients,
            JSON.stringify(analytics.topic_counts_json),
          ],
        )
        results.push({ practice_id: practice.id, practice_name: practice.name, status: 'ok' })
      } catch (err) {
        const msg = (err as Error).message
        console.error(`[rollup-analytics] upsert failed for ${practice.name}:`, msg)
        results.push({
          practice_id: practice.id,
          practice_name: practice.name,
          status: `error: ${msg}`,
        })
      }
    } catch (err) {
      console.error(`[rollup-analytics] compute failed for ${practice.name}:`, err)
      results.push({
        practice_id: practice.id,
        practice_name: practice.name,
        status: `error: ${(err as Error).message}`,
      })
    }
  }

  auditSystemEvent({
    action: 'cron.rollup-analytics.run',
    details: {
      date,
      total_practices: practices.length,
      ok: results.filter(r => r.status === 'ok').length,
      errors: results.filter(r => r.status.startsWith('error')).length,
    },
  }).catch(() => {})

  return { date, practices_processed: results.length, results }
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return unauthorized()
  }
  const body = await req.json().catch(() => ({}))
  const date = body?.date || getYesterday()
  const out = await runRollup(date)
  return NextResponse.json({ success: true, ...out })
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return unauthorized()
  }
  const date = req.nextUrl.searchParams.get('date') || getYesterday()
  const out = await runRollup(date)
  return NextResponse.json({ success: true, ...out })
}
