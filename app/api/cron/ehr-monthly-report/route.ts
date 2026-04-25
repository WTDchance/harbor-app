// Cron — monthly EHR practice report email.
// Runs on the 1st of each month via cron-job.org. Bearer ${CRON_SECRET}.
//
// For every practice with ehr_enabled=true:
//   - aggregate the previous month's activity from RDS
//   - render an HTML "Your practice last month" email
//   - send via Resend to owner_email (AWS canonical column)
// Idempotent per (practice_id, year-month) via ehr_processed_webhook_events.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'
import { sendEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

type MonthlyStats = {
  hours_seen: number
  sessions_completed: number
  no_show: number
  cancelled: number
  notes_signed: number
  assessments_completed: number
  new_patients: number
  revenue_cents: number
  billed_cents: number
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return unauthorized()
  }

  const now = new Date()
  const firstOfThis = new Date(now.getFullYear(), now.getMonth(), 1)
  const firstOfLast = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const monthTag =
    `${firstOfLast.getFullYear()}-${String(firstOfLast.getMonth() + 1).padStart(2, '0')}`
  const fromIso = firstOfLast.toISOString()
  const toIso = firstOfThis.toISOString()

  const practicesResult = await pool.query(
    `SELECT id, name, owner_email FROM practices
      WHERE COALESCE(ehr_enabled, false) = true`,
  )
  const practices = practicesResult.rows

  const results: Array<{ practice_id: string; status: string; reason?: string }> = []

  for (const p of practices) {
    const eventKey = `monthly-report-${p.id}-${monthTag}`

    // Idempotency check.
    const already = await pool.query(
      `SELECT event_id FROM ehr_processed_webhook_events
        WHERE event_id = $1 LIMIT 1`,
      [eventKey],
    ).catch(() => ({ rows: [] as any[] }))
    if (already.rows[0]) {
      results.push({ practice_id: p.id, status: 'skipped', reason: 'already_sent' })
      continue
    }

    if (!p.owner_email) {
      results.push({ practice_id: p.id, status: 'skipped', reason: 'no_email' })
      continue
    }

    try {
      const stats = await computeMonthlyStats(p.id, fromIso, toIso)
      const html = renderEmail(p.name, monthTag, stats)
      const sent = await sendEmail({
        to: p.owner_email,
        subject: `Your Harbor practice · ${monthTag}`,
        html,
      })
      if (!sent) {
        console.warn('[cron/monthly-report] sendEmail returned false', { practice: p.id })
      }
      await pool.query(
        `INSERT INTO ehr_processed_webhook_events (event_id, event_type, source)
         VALUES ($1, 'ehr.monthly_report', 'harbor_cron')`,
        [eventKey],
      ).catch(err => console.error('[cron/monthly-report] event marker insert failed', err))
      results.push({ practice_id: p.id, status: 'sent' })
    } catch (err) {
      console.error('[cron/monthly-report] failed for', p.id, err)
      results.push({
        practice_id: p.id,
        status: 'error',
        reason: err instanceof Error ? err.message : 'unknown',
      })
    }
  }

  auditSystemEvent({
    action: 'cron.ehr-monthly-report.run',
    details: {
      month: monthTag,
      total_practices: practices.length,
      sent: results.filter(r => r.status === 'sent').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      errors: results.filter(r => r.status === 'error').length,
    },
  }).catch(() => {})

  return NextResponse.json({ month: monthTag, results })
}

async function computeMonthlyStats(
  practiceId: string,
  fromIso: string,
  toIso: string,
): Promise<MonthlyStats> {
  // AWS canonical schema: appointments.scheduled_for (no actual_started_at /
  // actual_ended_at). Completed-session minutes derived from duration_minutes.
  const [appts, notes, assessments, newPatients, payments, charges] = await Promise.all([
    pool.query(
      `SELECT id, status, duration_minutes
         FROM appointments
        WHERE practice_id = $1
          AND scheduled_for >= $2 AND scheduled_for < $3`,
      [practiceId, fromIso, toIso],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT id, status, signed_at
         FROM ehr_progress_notes
        WHERE practice_id = $1
          AND created_at >= $2 AND created_at < $3`,
      [practiceId, fromIso, toIso],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT patient_id, assessment_type, score, completed_at, status
         FROM patient_assessments
        WHERE practice_id = $1
          AND completed_at >= $2 AND completed_at < $3
          AND status = 'completed'`,
      [practiceId, fromIso, toIso],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT id FROM patients
        WHERE practice_id = $1
          AND created_at >= $2 AND created_at < $3`,
      [practiceId, fromIso, toIso],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT amount_cents, source FROM ehr_payments
        WHERE practice_id = $1
          AND COALESCE(received_at, created_at) >= $2
          AND COALESCE(received_at, created_at) < $3`,
      [practiceId, fromIso, toIso],
    ).catch(() => ({ rows: [] as any[] })),
    pool.query(
      `SELECT id, status, allowed_cents FROM ehr_charges
        WHERE practice_id = $1
          AND service_date >= $2::date AND service_date < $3::date`,
      [practiceId, fromIso.slice(0, 10), toIso.slice(0, 10)],
    ).catch(() => ({ rows: [] as any[] })),
  ])

  let minutes = 0, completed = 0, noShow = 0, cancelled = 0
  for (const a of appts.rows) {
    if (a.status === 'completed') {
      completed++
      minutes += a.duration_minutes || 0
    }
    if (a.status === 'no_show' || a.status === 'no-show') noShow++
    if (a.status === 'cancelled') cancelled++
  }
  const notesSigned = notes.rows.filter(n => n.status === 'signed' || n.status === 'amended').length
  const assessmentCount = assessments.rows.length
  const newCount = newPatients.rows.length
  const revenue = payments.rows.reduce((s, p) => s + Number(p.amount_cents || 0), 0)
  const billed = charges.rows.reduce((s, c) => s + Number(c.allowed_cents || 0), 0)

  return {
    hours_seen: +(minutes / 60).toFixed(1),
    sessions_completed: completed,
    no_show: noShow,
    cancelled,
    notes_signed: notesSigned,
    assessments_completed: assessmentCount,
    new_patients: newCount,
    revenue_cents: revenue,
    billed_cents: billed,
  }
}

function cents(c: number): string { return `$${(c / 100).toFixed(2)}` }

function renderEmail(practiceName: string | null, monthTag: string, s: MonthlyStats): string {
  const friendlyMonth = new Date(monthTag + '-01')
    .toLocaleString(undefined, { month: 'long', year: 'numeric' })
  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
<h1 style="font-size:20px;color:#0d9488;margin:0 0 8px;">${practiceName ?? 'Your Harbor practice'} · ${friendlyMonth}</h1>
<p style="color:#555;font-size:14px;margin:0 0 20px;">Here's how last month looked.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;">
  <tr><td style="padding:8px 0;color:#555;">Hours seen</td><td style="text-align:right;font-weight:700;">${s.hours_seen}</td></tr>
  <tr><td style="padding:8px 0;color:#555;">Sessions completed</td><td style="text-align:right;font-weight:700;">${s.sessions_completed}</td></tr>
  <tr><td style="padding:8px 0;color:#555;">No-shows</td><td style="text-align:right;font-weight:700;">${s.no_show}</td></tr>
  <tr><td style="padding:8px 0;color:#555;">Cancellations</td><td style="text-align:right;font-weight:700;">${s.cancelled}</td></tr>
  <tr><td style="padding:8px 0;color:#555;border-top:1px solid #e5e7eb;">Notes signed</td><td style="text-align:right;font-weight:700;border-top:1px solid #e5e7eb;">${s.notes_signed}</td></tr>
  <tr><td style="padding:8px 0;color:#555;">Assessments completed</td><td style="text-align:right;font-weight:700;">${s.assessments_completed}</td></tr>
  <tr><td style="padding:8px 0;color:#555;">New patients</td><td style="text-align:right;font-weight:700;">${s.new_patients}</td></tr>
  <tr><td style="padding:8px 0;color:#555;border-top:1px solid #e5e7eb;">Billed</td><td style="text-align:right;font-weight:700;border-top:1px solid #e5e7eb;">${cents(s.billed_cents)}</td></tr>
  <tr><td style="padding:8px 0;color:#555;">Collected</td><td style="text-align:right;font-weight:700;color:#059669;">${cents(s.revenue_cents)}</td></tr>
</table>
<p style="color:#777;font-size:12px;margin-top:24px;">
Harbor EHR — built so you can spend less time on paperwork and more time with patients.
</p>
</body></html>`
}
