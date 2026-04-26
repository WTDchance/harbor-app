// app/api/roi/submit/route.ts
//
// Wave 23 (AWS port). Public ROI calculator submission. Pool insert
// + SES notification email to sales. Same calc semantics as legacy.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { sendEmail, EMAIL_SALES } from '@/lib/email'

interface RoiInputs {
  email?: string
  first_name?: string
  last_name?: string
  practice_name?: string
  phone?: string
  session_rate: number
  missed_calls_per_week: number
  missed_appointments_per_week?: number
  insurance_hours_per_week?: number
  weeks_worked_per_year?: number
  conversion_rate_pct?: number
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
        { status: 400 },
      )
    }

    const missed_patients_per_year =
      missed_calls_per_week * (conversion_rate_pct / 100) * weeks_worked_per_year
    const revenue_loss_from_calls_cents = Math.round(missed_patients_per_year * session_rate_cents)
    const revenue_loss_from_noshows_cents =
      missed_appointments_per_week * weeks_worked_per_year * session_rate_cents
    const annual_revenue_loss_cents = revenue_loss_from_calls_cents + revenue_loss_from_noshows_cents
    const annual_time_loss_cents = Math.round(
      insurance_hours_per_week * weeks_worked_per_year * session_rate_cents,
    )
    const annual_total_loss_cents = annual_revenue_loss_cents + annual_time_loss_cents

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip') || null
    const user_agent = req.headers.get('user-agent') || null

    let id = ''
    try {
      const { rows } = await pool.query(
        `INSERT INTO roi_calculator_submissions
            (email, first_name, last_name, practice_name, phone,
             session_rate_cents, missed_calls_per_week, missed_appointments_per_week,
             insurance_hours_per_week, weeks_worked_per_year, conversion_rate_pct,
             annual_revenue_loss_cents, annual_time_loss_cents, annual_total_loss_cents,
             utm_source, utm_medium, utm_campaign, utm_term, utm_content,
             referrer_url, user_agent, ip_address)
          VALUES ($1, $2, $3, $4, $5,
                  $6, $7, $8,
                  $9, $10, $11,
                  $12, $13, $14,
                  $15, $16, $17, $18, $19,
                  $20, $21, $22)
          RETURNING id, annual_total_loss_cents`,
        [
          body.email?.trim().toLowerCase() || null,
          body.first_name?.trim() || null,
          body.last_name?.trim() || null,
          body.practice_name?.trim() || null,
          body.phone?.trim() || null,
          session_rate_cents,
          missed_calls_per_week,
          missed_appointments_per_week,
          insurance_hours_per_week,
          weeks_worked_per_year,
          conversion_rate_pct,
          annual_revenue_loss_cents,
          annual_time_loss_cents,
          annual_total_loss_cents,
          body.utm_source || null,
          body.utm_medium || null,
          body.utm_campaign || null,
          body.utm_term || null,
          body.utm_content || null,
          body.referrer_url || null,
          user_agent,
          ip,
        ],
      )
      id = rows[0].id
    } catch (err) {
      console.error('[roi/submit]', (err as Error).message)
      return NextResponse.json({ error: 'Failed to save. Please try again.' }, { status: 500 })
    }

    try {
      const fmt = (cents: number) =>
        `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
      const fullName = [body.first_name, body.last_name].filter(Boolean).join(' ') || '(no name)'
      const emailLine = body.email ? ` &lt;${body.email}&gt;` : ''
      const practice = body.practice_name ? ` (${body.practice_name})` : ''
      const subject = `ROI calc submitted: ${fullName}${practice} — ${fmt(annual_total_loss_cents)}/yr`
      const html = `<div style="font-family:-apple-system,sans-serif;max-width:600px"><h2>New ROI submission</h2><p><strong>${fullName}</strong>${emailLine}${practice}</p><p>Total: <strong>${fmt(annual_total_loss_cents)}/yr</strong></p><p>Submission: ${id}</p></div>`
      await sendEmail({
        to: process.env.SALES_NOTIFICATION_EMAIL || 'chancewonser@gmail.com',
        subject, html, from: EMAIL_SALES,
      })
    } catch (notifyErr) {
      console.error('[roi/submit] notify failed:', notifyErr)
    }

    return NextResponse.json({
      ok: true,
      submission_id: id,
      annual_total_loss_cents,
    })
  } catch (err) {
    console.error('[roi/submit]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
