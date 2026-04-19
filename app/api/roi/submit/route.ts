// app/api/roi/submit/route.ts
// Harbor — Public ROI calculator submission endpoint.
// POST /api/roi/submit
//
// Unauthenticated — visitors on the public /roi page submit their practice
// numbers, we store them as a warm lead, and notify Chance via email so he can
// follow up same-day while the prospect is still thinking about their $X/year
// in missed revenue.
//
// Server-side recomputes the annual-loss numbers from the inputs so the DB
// is always the source of truth (client JS may change, calculation shouldn't).

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendEmail, EMAIL_SALES } from '@/lib/email'

interface RoiInputs {
  email?: string
  first_name?: string
  last_name?: string
  practice_name?: string
  phone?: string

  session_rate: number                  // dollars (UI input)
  missed_calls_per_week: number
  missed_appointments_per_week?: number
  insurance_hours_per_week?: number
  weeks_worked_per_year?: number        // default 48
  conversion_rate_pct?: number          // default 30 — how many missed-call prospects would've booked if reached

  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
  referrer_url?: string
}

function safeInt(v: any, fallback = 0, min = 0, max = 1_000_000): number {
  const n = Math.round(Number(v))
  if (!isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function safeNum(v: any, fallback = 0, min = 0, max = 1000): number {
  const n = Number(v)
  if (!isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as RoiInputs

    // --- Sanitize + coerce inputs ---
    const session_rate_dollars = safeNum(body.session_rate, 0, 0, 10000)
    const session_rate_cents = Math.round(session_rate_dollars * 100)
    const missed_calls_per_week = safeInt(body.missed_calls_per_week, 0, 0, 500)
    const missed_appointments_per_week = safeInt(body.missed_appointments_per_week, 0, 0, 500)
    const insurance_hours_per_week = safeNum(body.insurance_hours_per_week, 0, 0, 80)
    const weeks_worked_per_year = safeInt(body.weeks_worked_per_year, 48, 1, 52)
    const conversion_rate_pct = safeNum(body.conversion_rate_pct, 30, 0, 100)

    if (session_rate_cents <= 0 || missed_calls_per_week < 0) {
      return NextResponse.json(
        { error: 'session_rate and missed_calls_per_week are required.' },
        { status: 400 }
      )
    }

    // --- Calculate annual loss (cents) ---
    // Missed calls become missed patients — not every missed caller would have
    // booked, so we apply a conversion-rate haircut. Each new patient represents
    // multiple future sessions; we use a conservative "first-session-only" model
    // here so the number is defensible when you pitch it. You can always say
    // "and that's just session one — retention is 6-12 sessions."
    const missed_patients_per_year =
      missed_calls_per_week * (conversion_rate_pct / 100) * weeks_worked_per_year
    const revenue_loss_from_calls_cents = Math.round(
      missed_patients_per_year * session_rate_cents
    )

    // Missed/cancelled/no-show appointments are direct revenue loss at full session rate.
    const revenue_loss_from_noshows_cents =
      missed_appointments_per_week * weeks_worked_per_year * session_rate_cents

    const annual_revenue_loss_cents =
      revenue_loss_from_calls_cents + revenue_loss_from_noshows_cents

    // Time cost for insurance verification — priced at session-rate because
    // that's the opportunity cost of the therapist's time (can't see patients
    // while on hold with United).
    const annual_time_loss_cents = Math.round(
      insurance_hours_per_week * weeks_worked_per_year * session_rate_cents
    )

    const annual_total_loss_cents = annual_revenue_loss_cents + annual_time_loss_cents

    // --- Attribution + request metadata ---
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      null
    const user_agent = req.headers.get('user-agent') || null

    // --- Insert ---
    const { data, error } = await supabaseAdmin
      .from('roi_calculator_submissions')
      .insert({
        email: body.email?.trim().toLowerCase() || null,
        first_name: body.first_name?.trim() || null,
        last_name: body.last_name?.trim() || null,
        practice_name: body.practice_name?.trim() || null,
        phone: body.phone?.trim() || null,

        session_rate_cents,
        missed_calls_per_week,
        missed_appointments_per_week,
        insurance_hours_per_week,
        weeks_worked_per_year,
        conversion_rate_pct,

        annual_revenue_loss_cents,
        annual_time_loss_cents,
        annual_total_loss_cents,

        utm_source: body.utm_source || null,
        utm_medium: body.utm_medium || null,
        utm_campaign: body.utm_campaign || null,
        utm_term: body.utm_term || null,
        utm_content: body.utm_content || null,
        referrer_url: body.referrer_url || null,
        user_agent,
        ip_address: ip,
      })
      .select('id, annual_total_loss_cents')
      .single()

    if (error) {
      console.error('[roi/submit]', error)
      return NextResponse.json({ error: 'Failed to save. Please try again.' }, { status: 500 })
    }

    // --- Notify Chance (best-effort; failure here shouldn't break the submit) ---
    try {
      const fmt = (cents: number) =>
        `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
      const fullName = [body.first_name, body.last_name].filter(Boolean).join(' ') || '(no name)'
      const emailLine = body.email ? ` &lt;${body.email}&gt;` : ''
      const practice = body.practice_name ? ` (${body.practice_name})` : ''
      const subject = `ROI calc submitted: ${fullName}${practice} — ${fmt(annual_total_loss_cents)}/yr`
      const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="margin:0 0 12px;">New ROI calculator submission</h2>
  <p><strong>${fullName}</strong>${emailLine}${practice}</p>
  ${body.phone ? `<p>Phone: ${body.phone}</p>` : ''}

  <h3 style="margin:20px 0 6px;">Their numbers</h3>
  <ul style="margin:0; padding-left: 18px; line-height: 1.7;">
    <li>Session rate: ${fmt(session_rate_cents)}</li>
    <li>Missed calls/week: ${missed_calls_per_week}</li>
    <li>Missed appts/week: ${missed_appointments_per_week}</li>
    <li>Insurance hrs/week: ${insurance_hours_per_week}</li>
    <li>Weeks worked/year: ${weeks_worked_per_year}</li>
    <li>Conversion rate: ${conversion_rate_pct}%</li>
  </ul>

  <h3 style="margin:20px 0 6px;">Annual loss (calculated)</h3>
  <ul style="margin:0; padding-left: 18px; line-height: 1.7;">
    <li>Missed-call revenue loss: <strong>${fmt(revenue_loss_from_calls_cents)}</strong></li>
    <li>Missed-appointment revenue loss: <strong>${fmt(revenue_loss_from_noshows_cents)}</strong></li>
    <li>Insurance-verification time cost: <strong>${fmt(annual_time_loss_cents)}</strong></li>
    <li style="margin-top:6px;">Total: <strong style="color:#b91c1c;">${fmt(annual_total_loss_cents)}/year</strong></li>
  </ul>

  ${body.utm_source ? `<p style="color:#6b7280; font-size:13px; margin-top:20px;">Source: ${body.utm_source}${body.utm_campaign ? ` / ${body.utm_campaign}` : ''}${body.utm_medium ? ` (${body.utm_medium})` : ''}</p>` : ''}
  ${body.referrer_url ? `<p style="color:#6b7280; font-size:13px;">Referrer: ${body.referrer_url}</p>` : ''}

  <p style="margin-top:24px; color:#6b7280; font-size:13px;">Submission ID: ${data.id}</p>
</div>`
      // Send to Chance's inbox
      await sendEmail({
        to: process.env.SALES_NOTIFICATION_EMAIL || 'chancewonser@gmail.com',
        subject,
        html,
        from: EMAIL_SALES,
      })
    } catch (notifyErr) {
      // Non-fatal
      console.error('[roi/submit] notify failed:', notifyErr)
    }

    return NextResponse.json({
      ok: true,
      submission_id: data.id,
      annual_total_loss_cents: data.annual_total_loss_cents,
    })
  } catch (err) {
    console.error('[roi/submit]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
