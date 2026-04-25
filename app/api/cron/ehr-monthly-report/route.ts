// app/api/cron/ehr-monthly-report/route.ts
// Runs on the 1st of every month (via cron-job.org, Bearer CRON_SECRET).
// For every practice with ehr_enabled:
//   - aggregate the previous month's activity
//   - render an HTML "Your practice last month" email
//   - send via Resend to notification_email
// Idempotent per (practice_id, year-month) via ehr_processed_webhook_events.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Harbor already has lib/email.ts for Resend. We import send() from it.
// If the helper has a different name in your codebase, adjust here.
let sendEmail: ((args: { to: string; subject: string; html: string; from?: string }) => Promise<any>) | null = null
try {
  // Dynamic so the cron doesn't hard-fail if the helper shape drifts.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  sendEmail = require('@/lib/email').sendEmail
} catch {
  sendEmail = null
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Compute "last month" window in server time
  const now = new Date()
  const firstOfThis = new Date(now.getFullYear(), now.getMonth(), 1)
  const firstOfLast = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const monthTag = `${firstOfLast.getFullYear()}-${String(firstOfLast.getMonth() + 1).padStart(2, '0')}`
  const fromDate = firstOfLast.toISOString().slice(0, 10)
  const toDate = firstOfThis.toISOString().slice(0, 10)

  const { data: practices } = await supabaseAdmin
    .from('practices').select('id, name, notification_email, ui_preferences').eq('ehr_enabled', true)

  const results: Array<{ practice_id: string; status: string; reason?: string }> = []

  for (const p of practices ?? []) {
    const eventKey = `monthly-report-${p.id}-${monthTag}`
    const { data: already } = await supabaseAdmin
      .from('ehr_processed_webhook_events').select('event_id').eq('event_id', eventKey).maybeSingle()
    if (already) { results.push({ practice_id: p.id, status: 'skipped', reason: 'already_sent' }); continue }
    if (!p.notification_email) { results.push({ practice_id: p.id, status: 'skipped', reason: 'no_email' }); continue }

    try {
      const stats = await computeMonthlyStats(p.id, fromDate, toDate)
      const html = renderEmail(p.name, monthTag, stats)
      if (sendEmail) {
        await sendEmail({
          to: p.notification_email,
          subject: `Your Harbor practice · ${monthTag}`,
          html,
        })
      } else {
        // Fallback: if email helper isn't available, just record the run.
        console.warn('[cron/monthly-report] email helper missing; report computed but not sent', { practice: p.id })
      }

      await supabaseAdmin.from('ehr_processed_webhook_events').insert({
        event_id: eventKey,
        event_type: 'ehr.monthly_report',
        source: 'harbor_cron',
      })
      results.push({ practice_id: p.id, status: 'sent' })
    } catch (err) {
      console.error('[cron/monthly-report] failed for', p.id, err)
      results.push({ practice_id: p.id, status: 'error', reason: err instanceof Error ? err.message : 'unknown' })
    }
  }

  return NextResponse.json({ month: monthTag, results })
}

async function computeMonthlyStats(practiceId: string, fromDate: string, toDate: string) {
  const [appts, notes, assessments, newPatients, payments, charges] = await Promise.all([
    supabaseAdmin.from('appointments').select('id, status, duration_minutes, actual_started_at, actual_ended_at')
      .eq('practice_id', practiceId).gte('appointment_date', fromDate).lt('appointment_date', toDate),
    supabaseAdmin.from('ehr_progress_notes').select('id, status, signed_at')
      .eq('practice_id', practiceId).gte('created_at', fromDate).lt('created_at', toDate),
    supabaseAdmin.from('patient_assessments').select('patient_id, assessment_type, score, completed_at, status')
      .eq('practice_id', practiceId).gte('completed_at', fromDate).lt('completed_at', toDate).eq('status', 'completed'),
    supabaseAdmin.from('patients').select('id')
      .eq('practice_id', practiceId).gte('created_at', fromDate).lt('created_at', toDate),
    supabaseAdmin.from('ehr_payments').select('amount_cents, source')
      .eq('practice_id', practiceId).gte('received_at', fromDate).lt('received_at', toDate),
    supabaseAdmin.from('ehr_charges').select('id, status, allowed_cents')
      .eq('practice_id', practiceId).gte('service_date', fromDate).lt('service_date', toDate),
  ])

  let minutes = 0; let completed = 0; let noShow = 0; let cancelled = 0
  for (const a of appts.data ?? []) {
    if (a.status === 'completed') {
      completed++
      if (a.actual_started_at && a.actual_ended_at) {
        minutes += Math.max(0, Math.round((new Date(a.actual_ended_at).getTime() - new Date(a.actual_started_at).getTime()) / 60000))
      } else {
        minutes += a.duration_minutes || 0
      }
    }
    if (a.status === 'no-show') noShow++
    if (a.status === 'cancelled') cancelled++
  }

  const notesSigned = (notes.data ?? []).filter((n) => n.status === 'signed' || n.status === 'amended').length
  const assessmentCount = (assessments.data ?? []).length
  const newCount = (newPatients.data ?? []).length
  const revenue = (payments.data ?? []).reduce((s, p) => s + Number(p.amount_cents), 0)
  const billed = (charges.data ?? []).reduce((s, c) => s + Number(c.allowed_cents), 0)

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

function renderEmail(practiceName: string | null, monthTag: string, s: any): string {
  const friendlyMonth = new Date(monthTag + '-01').toLocaleString(undefined, { month: 'long', year: 'numeric' })
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
