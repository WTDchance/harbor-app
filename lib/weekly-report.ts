// lib/weekly-report.ts
// Computes per-practice weekly ROI metrics and builds the HTML email.
import { supabaseAdmin } from '@/lib/supabase'
export interface WeeklyMetrics {
    practice_id: string
    practice_name: string
    week_start: string
    week_end: string
    answered_calls: number
    booked_appointments: number
    filled_cancellations: number
    new_patients: number
    avg_session_fee: number
    conversion_rate: number
    estimated_pipeline_value: number
    estimated_booked_revenue: number
    estimated_filled_revenue: number
    total_estimated_impact: number
}
const ANSWERED_CALL_MIN_SECONDS = 20
export function lastWeekRangeUtc(now: Date = new Date()): { start: Date; end: Date } {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const dow = d.getUTCDay()
    const daysSinceMonday = (dow + 6) % 7
    const thisMonday = new Date(d)
    thisMonday.setUTCDate(d.getUTCDate() - daysSinceMonday)
    const lastMonday = new Date(thisMonday)
    lastMonday.setUTCDate(thisMonday.getUTCDate() - 7)
    const lastSunday = new Date(lastMonday)
    lastSunday.setUTCDate(lastMonday.getUTCDate() + 6)
    lastSunday.setUTCHours(23, 59, 59, 999)
    return { start: lastMonday, end: lastSunday }
}
function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10)
}
function fmtUSD(n: number): string {
    return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function longDate(iso: string): string {
    const d = new Date(iso + 'T12:00:00Z')
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
export async function computeWeeklyMetrics(
    practiceId: string,
    range?: { start: Date; end: Date }
  ): Promise<WeeklyMetrics | null> {
    const { start, end } = range || lastWeekRangeUtc()
    const startIso = start.toISOString()
    const endIso = end.toISOString()
    const { data: practice, error: pErr } = await supabaseAdmin
      .from('practices')
      .select('id, name, avg_session_fee, answered_call_conversion_rate')
      .eq('id', practiceId)
      .single()
    if (pErr || !practice) {
          console.error('[weekly-report] practice not found', practiceId, pErr)
          return null
    }
    const avgFee = Number(practice.avg_session_fee ?? 150)
    const convRate = Number(practice.answered_call_conversion_rate ?? 0.35)
    const { count: answered } = await supabaseAdmin
      .from('call_logs')
      .select('*', { count: 'exact', head: true })
      .eq('practice_id', practiceId)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .gte('duration_seconds', ANSWERED_CALL_MIN_SECONDS)
    const { count: booked } = await supabaseAdmin
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('practice_id', practiceId)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .in('status', ['scheduled', 'completed'])
    const { count: filled } = await supabaseAdmin
      .from('waitlist')
      .select('*', { count: 'exact', head: true })
      .eq('practice_id', practiceId)
      .gte('claimed_slot_at', startIso)
      .lte('claimed_slot_at', endIso)
    const { count: newPatients } = await supabaseAdmin
      .from('patients')
      .select('*', { count: 'exact', head: true })
      .eq('practice_id', practiceId)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
    const answeredCalls = answered ?? 0
    const bookedAppts = booked ?? 0
    const filledCxl = filled ?? 0
    const newPts = newPatients ?? 0
    const pipelineValue = Math.round(answeredCalls * avgFee * convRate)
    const bookedRev = Math.round(bookedAppts * avgFee)
    const filledRev = Math.round(filledCxl * avgFee)
    return {
          practice_id: practiceId,
          practice_name: practice.name,
          week_start: isoDate(start),
          week_end: isoDate(end),
          answered_calls: answeredCalls,
          booked_appointments: bookedAppts,
          filled_cancellations: filledCxl,
          new_patients: newPts,
          avg_session_fee: avgFee,
          conversion_rate: convRate,
          estimated_pipeline_value: pipelineValue,
          estimated_booked_revenue: bookedRev,
          estimated_filled_revenue: filledRev,
          total_estimated_impact: bookedRev + filledRev,
    }
}
export function buildWeeklyReportEmail(m: WeeklyMetrics): { subject: string; html: string } {
    const NAVY = '#1f375d'
    const TEAL = '#52bfc0'
    const BLUE = '#3e85af'
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
    const subject = `Harbor weekly recap — ${fmtUSD(m.total_estimated_impact)} booked + filled (${longDate(m.week_start)})`
    const stat = (label: string, value: string, sub?: string, accent: string = TEAL) => `<td style="padding:16px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;vertical-align:top;width:50%"><div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;font-weight:600">${label}</div><div style="font-size:28px;color:${accent};font-weight:700;margin-top:6px;line-height:1.1">${value}</div>${sub ? `<div style="font-size:12px;color:#64748b;margin-top:4px">${sub}</div>` : ''}</td>`
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${subject}</title></head><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a"><div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(15,23,42,0.08)"><div style="background:${NAVY};padding:28px 32px;color:#ffffff"><div style="font-size:12px;letter-spacing:0.1em;text-transform:uppercase;opacity:0.8">Harbor weekly recap</div><h1 style="margin:6px 0 0 0;font-size:22px;font-weight:600">${m.practice_name}</h1><div style="margin-top:4px;font-size:14px;opacity:0.85">${longDate(m.week_start)} – ${longDate(m.week_end)}</div></div><div style="padding:28px 32px"><p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;color:#334155">Here's what Ellie did for you last week. These numbers are the receptionist work Harbor handled so you didn't have to.</p><table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:separate;border-spacing:8px"><tr>${stat('Answered calls', String(m.answered_calls), 'conversations ≥ 20s', TEAL)}${stat('Booked appts', String(m.booked_appointments), 'scheduled or completed', BLUE)}</tr><tr>${stat('Filled cancellations', String(m.filled_cancellations), 'empty slots rescued', TEAL)}${stat('New patients', String(m.new_patients), 'first-time intakes', BLUE)}</tr></table><div style="margin-top:28px;padding:20px 22px;background:${NAVY};border-radius:12px;color:#ffffff"><div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.75">Estimated impact</div><div style="font-size:32px;font-weight:700;margin-top:4px">${fmtUSD(m.total_estimated_impact)}</div><div style="font-size:13px;opacity:0.85;margin-top:6px">Booked revenue ${fmtUSD(m.estimated_booked_revenue)} + recovered cancellati
