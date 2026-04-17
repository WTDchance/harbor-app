// Tier 2C: Daily practice analytics rollup
// Aggregates call_logs, appointments, patients, and intake_forms
// into a single practice_analytics row per practice per day.
// Run via cron or manually: POST /api/admin/rollup-analytics
// Optional body: { "date": "2026-04-17" } — defaults to yesterday

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  // Auth: require CRON_SECRET bearer token
  const authHeader = req.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const targetDate = body.date || getYesterday()

    console.log(`[Analytics] Rolling up metrics for ${targetDate}`)

    // Get all active practices
    const { data: practices, error: practicesErr } = await supabaseAdmin
      .from('practices')
      .select('id, name')

    if (practicesErr || !practices) {
      console.error('[Analytics] Failed to fetch practices:', practicesErr?.message)
      return NextResponse.json({ error: 'Failed to fetch practices' }, { status: 500 })
    }

    const results: Array<{ practice_id: string; practice_name: string; status: string }> = []

    for (const practice of practices) {
      try {
        const analytics = await computeDailyAnalytics(practice.id, targetDate)

        // Upsert into practice_analytics (unique on practice_id + date)
        const { error: upsertErr } = await supabaseAdmin
          .from('practice_analytics')
          .upsert(
            {
              practice_id: practice.id,
              date: targetDate,
              ...analytics,
              computed_at: new Date().toISOString(),
            },
            { onConflict: 'practice_id,date' }
          )

        if (upsertErr) {
          console.error(`[Analytics] Upsert failed for ${practice.name}:`, upsertErr.message)
          results.push({ practice_id: practice.id, practice_name: practice.name, status: `error: ${upsertErr.message}` })
        } else {
          console.log(`[Analytics] ${practice.name}: ${analytics.total_calls} calls, ${analytics.total_bookings} bookings, ${analytics.new_patients} new patients`)
          results.push({ practice_id: practice.id, practice_name: practice.name, status: 'ok' })
        }
      } catch (err: any) {
        console.error(`[Analytics] Error computing for ${practice.name}:`, err?.message)
        results.push({ practice_id: practice.id, practice_name: practice.name, status: `error: ${err?.message}` })
      }
    }

    return NextResponse.json({
      success: true,
      date: targetDate,
      practices_processed: results.length,
      results,
    })
  } catch (error: any) {
    console.error('[Analytics] Rollup error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Also support GET for quick manual trigger from browser with query param
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date') || getYesterday()

  // Delegate to POST handler logic
  const fakeReq = new NextRequest(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify({ date }),
  })
  return POST(fakeReq)
}

function getYesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

async function computeDailyAnalytics(practiceId: string, date: string) {
  const dayStart = `${date}T00:00:00.000Z`
  const dayEnd = `${date}T23:59:59.999Z`

  // --- Call metrics ---
  const { data: calls } = await supabaseAdmin
    .from('call_logs')
    .select('id, duration_seconds, call_outcome, is_new_patient, booking_attempted, booking_succeeded, topics_discussed, sentiment_score')
    .eq('practice_id', practiceId)
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd)

  const callList = calls || []
  const totalCalls = callList.length
  const newPatientCalls = callList.filter(c => c.is_new_patient === true).length
  const returningPatientCalls = callList.filter(c => c.is_new_patient === false).length

  const durations = callList.map(c => c.duration_seconds).filter((d): d is number => d != null && d > 0)
  const avgCallDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : null

  const sentiments = callList.map(c => c.sentiment_score).filter((s): s is number => s != null)
  const avgSentiment = sentiments.length > 0
    ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length
    : null

  // --- Booking metrics ---
  const bookingAttempted = callList.filter(c => c.booking_attempted === true).length
  const bookingSucceeded = callList.filter(c => c.booking_succeeded === true).length
  const bookingConversionRate = bookingAttempted > 0
    ? bookingSucceeded / bookingAttempted
    : null

  // --- Topic counts ---
  const topicCounts: Record<string, number> = {}
  for (const call of callList) {
    if (Array.isArray(call.topics_discussed)) {
      for (const topic of call.topics_discussed) {
        topicCounts[topic] = (topicCounts[topic] || 0) + 1
      }
    }
  }

  // --- Intake metrics ---
  const { count: intakesSent } = await supabaseAdmin
    .from('intake_forms')
    .select('id', { count: 'exact', head: true })
    .eq('practice_id', practiceId)
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd)

  const { count: intakesCompleted } = await supabaseAdmin
    .from('intake_forms')
    .select('id', { count: 'exact', head: true })
    .eq('practice_id', practiceId)
    .eq('status', 'completed')
    .gte('completed_at', dayStart)
    .lte('completed_at', dayEnd)

  const intakeSentNum = intakesSent || 0
  const intakeCompletedNum = intakesCompleted || 0
  const intakeCompletionRate = intakeSentNum > 0
    ? intakeCompletedNum / intakeSentNum
    : null

  // --- Appointment metrics ---
  const { data: appointments } = await supabaseAdmin
    .from('appointments')
    .select('id, status, no_show')
    .eq('practice_id', practiceId)
    .gte('appointment_date', dayStart)
    .lte('appointment_date', dayEnd)

  const appointmentList = appointments || []
  const totalAppointments = appointmentList.length
  const totalNoShows = appointmentList.filter(a => a.no_show === true).length
  const totalCancellations = appointmentList.filter(a => a.status === 'cancelled').length
  const noShowRate = totalAppointments > 0
    ? totalNoShows / totalAppointments
    : null

  // --- New patients ---
  const { count: newPatients } = await supabaseAdmin
    .from('patients')
    .select('id', { count: 'exact', head: true })
    .eq('practice_id', practiceId)
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd)

  return {
    total_calls: totalCalls,
    new_patient_calls: newPatientCalls,
    returning_patient_calls: returningPatientCalls,
    avg_call_duration_seconds: avgCallDuration,
    avg_sentiment: avgSentiment,
    total_bookings: bookingSucceeded,
    booking_conversion_rate: bookingConversionRate,
    intakes_sent: intakeSentNum,
    intakes_completed: intakeCompletedNum,
    intake_completion_rate: intakeCompletionRate,
    total_appointments: totalAppointments,
    total_no_shows: totalNoShows,
    total_cancellations: totalCancellations,
    no_show_rate: noShowRate,
    new_patients: newPatients || 0,
    topic_counts_json: topicCounts,
  }
}
