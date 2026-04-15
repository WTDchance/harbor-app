// app/api/reports/weekly/run/route.ts
// Weekly ROI report dispatcher. Called by pg_cron (Monday 14:00 UTC).
// Protected by x-cron-secret header (RECONCILER_SECRET, shared with reconciler).
//
// Query params:
//   practice_id=<uuid>   Run for a single practice (manual test). Bypasses the
//                        weekly_report_enabled flag.
//   dry=1                Compute metrics and build email but do NOT send or
//                        write the audit row. Returns metrics in the JSON.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendEmail, EMAIL_CHANCE } from '@/lib/email'
import {
    computeWeeklyMetrics,
    buildWeeklyReportEmail,
    lastWeekRangeUtc,
  } from '@/lib/weekly-report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CRON_SECRET = process.env.RECONCILER_SECRET

interface RunResult {
    practice_id: string
    practice_name: string
    sent: boolean
    recipient?: string
    reason?: string
  }

export async function GET(req: NextRequest) {
    const secret = req.headers.get('x-cron-secret')
    if (CRON_SECRET && secret !== CRON_SECRET) {
          return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
        }

    const url = req.nextUrl
    const singlePractice = url.searchParams.get('practice_id') || undefined
    const dry = url.searchParams.get('dry') === '1'

    const { start, end } = lastWeekRangeUtc()
    const weekStartIso = start.toISOString().slice(0, 10)

    let practicesQuery = supabaseAdmin
      .from('practices')
      .select('id, name, weekly_report_enabled, weekly_report_email, billing_email, notification_email')

    if (singlePractice) {
          practicesQuery = practicesQuery.eq('id', singlePractice)
        } else {
          practicesQuery = practicesQuery.eq('weekly_report_enabled', true)
        }

    const { data: practices, error: pErr } = await practicesQuery
    if (pErr) {
          return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 })
        }
    if (!practices || practices.length === 0) {
          return NextResponse.json({ ok: true, results: [], note: 'no eligible practices' })
        }

    const results: RunResult[] = []

    for (const p of practices) {
          const recipient =
            (p as any).weekly_report_email ||
            (p as any).billing_email ||
            (p as any).notification_email ||
            null

          const baseResult: RunResult = { practice_id: p.id, practice_name: p.name, sent: false }

          if (!recipient) {
                  results.push({ ...baseResult, reason: 'no recipient configured' })
                  continue
                }

          if (!dry) {
                  const { data: existing } = await supabaseAdmin
                    .from('weekly_reports')
                    .select('id, sent_at')
                    .eq('practice_id', p.id)
                    .eq('week_start', weekStartIso)
                    .maybeSingle()
                  if (existing?.sent_at) {
                            results.push({ ...baseResult, reason: 'already sent this week', recipient })
                            continue
                          }
                }

          const metrics = await computeWeeklyMetrics(p.id, { start, end })
          if (!metrics) {
                  results.push({ ...baseResult, reason: 'metrics computation failed' })
                  continue
                }

          const { subject, html } = buildWeeklyReportEmail(metrics)

          if (dry) {
                  results.push({ ...baseResult, recipient, reason: 'dry-run', sent: false })
                  continue
                }

          const ok = await sendEmail({ to: recipient, subject, html, from: EMAIL_CHANCE })

          const auditRow = {
                  practice_id: p.id,
                  week_start: metrics.week_start,
                  week_end: metrics.week_end,
                  answered_calls: metrics.answered_calls,
                  booked_appointments: metrics.booked_appointments,
                  filled_cancellations: metrics.filled_cancellations,
                  new_patients: metrics.new_patients,
                  estimated_pipeline_value: metrics.estimated_pipeline_value,
                  estimated_booked_revenue: metrics.estimated_booked_revenue,
                  estimated_filled_revenue: metrics.estimated_filled_revenue,
                  recipient_email: recipient,
                  sent_at: ok ? new Date().toISOString() : null,
                  error: ok ? null : 'sendEmail returned false',
                }

          await supabaseAdmin
            .from('weekly_reports')
            .upsert(auditRow, { onConflict: 'practice_id,week_start' })

          results.push({ ...baseResult, recipient, sent: ok, reason: ok ? undefined : 'send failed' })
        }

    return NextResponse.json({
          ok: true,
          week_start: weekStartIso,
          week_end: end.toISOString().slice(0, 10),
          count: results.length,
          sent: results.filter((r) => r.sent).length,
          results,
        })
  }
