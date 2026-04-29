// app/api/cron/schedule-sms-reminders/route.ts
//
// Wave 50 — appointment-reminder dispatcher. Runs every 5 minutes via
// cron-job.org with `Authorization: Bearer ${CRON_SECRET}`. The
// dispatcher is idempotent: a given (appointment_id, threshold) pair
// gets at most ONE row in sms_send_log (status in
// {'sent','dry_run_skipped','suppressed','preference_disabled'}) and
// the next tick will skip any pair already present.
//
// Threshold buckets:
//   24h   — appointment.scheduled_for in [+23h45m, +24h15m]
//   2h    — appointment.scheduled_for in [+1h45m,  +2h15m]
//   30min — appointment.scheduled_for in [+25m,    +35m]
//
// Tolerance is the cron interval (5min) plus a small jitter so a
// scheduled tick that fires a minute late still catches the slot.
//
// The wrapper (lib/aws/signalwire-sms.sendSms) handles E.164 validation,
// suppression list, per-user pref, dry-run vs live, and audit. This
// route just decides WHICH rows to send.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { assertCronAuthorized } from '@/lib/cron-auth'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { sendSms } from '@/lib/aws/signalwire-sms'
import { renderSmsTemplate, type SmsTemplateCategory } from '@/lib/aws/sms-templates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Threshold = '24h' | '2h' | '30min'

interface ThresholdSpec {
  threshold: Threshold
  category: SmsTemplateCategory
  /** Lower bound, in minutes from now. */
  minMinutes: number
  /** Upper bound, in minutes from now. */
  maxMinutes: number
}

const THRESHOLDS: ThresholdSpec[] = [
  { threshold: '24h',   category: 'reminder_24h',   minMinutes: 24 * 60 - 15, maxMinutes: 24 * 60 + 15 },
  { threshold: '2h',    category: 'reminder_2h',    minMinutes: 2 * 60 - 15,  maxMinutes: 2 * 60 + 15 },
  { threshold: '30min', category: 'reminder_30min', minMinutes: 25,           maxMinutes: 35 },
]

interface DueRow {
  appointment_id: string
  practice_id: string
  patient_id: string | null
  scheduled_for: string
  patient_phone: string | null
  patient_first_name: string | null
  therapist_name: string | null
  practice_name: string | null
  patient_user_id: string | null
}

async function loadDueAppointments(spec: ThresholdSpec): Promise<DueRow[]> {
  // Cast the bounds to interval literals server-side. We use a single
  // SELECT with LEFT JOINs so we get patient + practice context in one
  // round trip; the cron route is hot path enough that an extra query
  // per row would burn through the connection pool fast.
  //
  // The dedup is enforced by the LEFT JOIN against sms_send_log filtered
  // on the same threshold — any row where a prior log exists is dropped.
  try {
    const { rows } = await pool.query<DueRow>(
      `SELECT
         a.id            AS appointment_id,
         a.practice_id,
         a.patient_id,
         a.scheduled_for,
         p.phone         AS patient_phone,
         p.first_name    AS patient_first_name,
         p.user_id       AS patient_user_id,
         pr.name         AS practice_name,
         COALESCE(t.first_name, '')                          AS therapist_name
       FROM appointments a
       JOIN practices  pr ON pr.id = a.practice_id
       LEFT JOIN patients  p  ON p.id  = a.patient_id
       LEFT JOIN therapists t ON t.id  = a.therapist_id
       LEFT JOIN sms_send_log s ON s.appointment_id = a.id
                              AND s.reminder_threshold = $3
                              AND s.status IN ('sent','dry_run_skipped','suppressed','preference_disabled')
       WHERE a.status NOT IN ('cancelled','cancelled_late','no_show','completed')
         AND a.scheduled_for BETWEEN now() + ($1::int * interval '1 minute')
                                 AND now() + ($2::int * interval '1 minute')
         AND p.phone IS NOT NULL
         AND s.id IS NULL
       LIMIT 200`,
      [spec.minMinutes, spec.maxMinutes, spec.threshold],
    )
    return rows
  } catch (err) {
    // Schema gap (e.g. patients.user_id or therapists.first_name missing
    // on a fresh env). Fall back to the smaller projection used by the
    // cancellation-fill dispatcher and fill the rest with nulls.
    console.error('[cron/sms-reminders] full query failed, falling back:', (err as Error).message)
    try {
      const { rows } = await pool.query(
        `SELECT
           a.id            AS appointment_id,
           a.practice_id,
           a.patient_id,
           a.scheduled_for,
           p.phone         AS patient_phone,
           p.first_name    AS patient_first_name,
           pr.name         AS practice_name
         FROM appointments a
         JOIN practices pr ON pr.id = a.practice_id
         LEFT JOIN patients p ON p.id = a.patient_id
         LEFT JOIN sms_send_log s ON s.appointment_id = a.id
                                AND s.reminder_threshold = $3
                                AND s.status IN ('sent','dry_run_skipped','suppressed','preference_disabled')
         WHERE a.status NOT IN ('cancelled','cancelled_late','no_show','completed')
           AND a.scheduled_for BETWEEN now() + ($1::int * interval '1 minute')
                                   AND now() + ($2::int * interval '1 minute')
           AND p.phone IS NOT NULL
           AND s.id IS NULL
         LIMIT 200`,
        [spec.minMinutes, spec.maxMinutes, spec.threshold],
      )
      return rows.map(r => ({
        ...r,
        therapist_name: '',
        patient_user_id: null,
      })) as DueRow[]
    } catch (err2) {
      console.error('[cron/sms-reminders] fallback also failed:', (err2 as Error).message)
      return []
    }
  }
}

function formatLocalTime(iso: string): string {
  // Practice-local TZ rendering would require joining practice timezone;
  // for a 24h/2h/30min reminder a UTC-ish "Apr 30 3:30 PM" rendering is
  // adequate. Real localisation hooks land alongside the calendar feed
  // wave when practices.timezone is canonical.
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return iso
  }
}

interface TickSummary {
  threshold: Threshold
  candidates: number
  sent: number
  dry_run: number
  suppressed: number
  preference_disabled: number
  invalid_number: number
  errors: number
}

async function processThreshold(spec: ThresholdSpec): Promise<TickSummary> {
  const summary: TickSummary = {
    threshold: spec.threshold,
    candidates: 0,
    sent: 0,
    dry_run: 0,
    suppressed: 0,
    preference_disabled: 0,
    invalid_number: 0,
    errors: 0,
  }

  const due = await loadDueAppointments(spec)
  summary.candidates = due.length

  for (const row of due) {
    if (!row.patient_phone) continue

    let body: string
    try {
      body = renderSmsTemplate(spec.category, {
        first_name: row.patient_first_name || 'there',
        therapist_name: row.therapist_name || 'your therapist',
        practice_name: row.practice_name || 'your practice',
        appt_time_local: formatLocalTime(row.scheduled_for),
      })
    } catch (err) {
      console.error('[cron/sms-reminders] render failed:', (err as Error).message)
      summary.errors += 1
      continue
    }

    const result = await sendSms({
      to: row.patient_phone,
      body,
      practice_id: row.practice_id,
      audit_event_type: 'sms.reminder.dispatched',
      appointment_id: row.appointment_id,
      patient_id: row.patient_id,
      user_id: row.patient_user_id,
      template_category: spec.category,
      reminder_threshold: spec.threshold,
      preference_column: 'sms_appointment_reminders_enabled',
    })

    if (result.ok) {
      if (result.status === 'sent') summary.sent += 1
      else summary.dry_run += 1
    } else {
      switch (result.status) {
        case 'suppressed':           summary.suppressed += 1; break
        case 'preference_disabled':  summary.preference_disabled += 1; break
        case 'invalid_number':       summary.invalid_number += 1; break
        default:                     summary.errors += 1; break
      }
    }
  }

  return summary
}

// ---------------------------------------------------------------------------
// HTTP handler — accepts both GET and POST so the various external
// schedulers (cron-job.org, EventBridge, Render cron) can use whichever
// verb they default to.
// ---------------------------------------------------------------------------
async function tick(req: NextRequest): Promise<NextResponse> {
  const unauthorized = assertCronAuthorized(req)
  if (unauthorized) return unauthorized

  const startedAt = Date.now()
  const summaries: TickSummary[] = []
  for (const spec of THRESHOLDS) {
    summaries.push(await processThreshold(spec))
  }
  const durationMs = Date.now() - startedAt

  await auditSystemEvent({
    action: 'sms.reminder.cron_tick',
    severity: 'info',
    resourceType: 'cron',
    details: {
      duration_ms: durationMs,
      summaries,
      live_send: (process.env.SMS_LIVE_SEND || '').toLowerCase() === 'true',
    },
  })

  return NextResponse.json({
    ok: true,
    duration_ms: durationMs,
    summaries,
  })
}

export async function GET(req: NextRequest)  { return tick(req) }
export async function POST(req: NextRequest) { return tick(req) }
