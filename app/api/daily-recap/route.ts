// Daily Recap API
// GET  — preview recap for a practice (dashboard use)
// POST — send the daily recap (called by cron or manually)

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase-server'

async function getPracticeId(): Promise<string | null> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabaseAdmin.from('users').select('practice_id').eq('id', user.id).single()
  return data?.practice_id || null
}

function buildRecapData(changes: any[], tomorrowAppts: any[]) {
  const created = changes.filter(c => c.change_type === 'created')
  const rescheduled = changes.filter(c => c.change_type === 'rescheduled')
  const cancelled = changes.filter(c => c.change_type === 'cancelled')

  return {
    summary: {
      total_changes: changes.length,
      new_appointments: created.length,
      rescheduled: rescheduled.length,
      cancelled: cancelled.length,
      tomorrow_appointments: tomorrowAppts.length,
    },
    changes: changes.map(c => ({
      type: c.change_type,
      patient: c.patients ? `${c.patients.first_name} ${c.patients.last_name}` : 'Unknown',
      previous_time: c.previous_time,
      new_time: c.new_time,
      status: c.status,
      dob_verified: c.dob_verified,
    })),
    tomorrow: tomorrowAppts.map(a => ({
      patient: a.patients ? `${a.patients.first_name} ${a.patients.last_name}` : 'Unknown',
      time: a.scheduled_at,
      duration: a.duration_minutes,
      status: a.status,
    })),
  }
}

function formatRecapText(recap: ReturnType<typeof buildRecapData>, practiceName: string, aiName: string): string {
  const s = recap.summary
  let text = `Daily Schedule Recap for ${practiceName}\n`
  text += `From ${aiName}, your Harbor receptionist\n\n`

  text += `Today's Changes:\n`
  if (s.total_changes === 0) {
    text += `  No schedule changes today.\n`
  } else {
    if (s.new_appointments > 0) text += `  ${s.new_appointments} new appointment(s) booked\n`
    if (s.rescheduled > 0) text += `  ${s.rescheduled} appointment(s) rescheduled\n`
    if (s.cancelled > 0) text += `  ${s.cancelled} appointment(s) cancelled\n`

    text += `\nDetails:\n`
    for (const c of recap.changes) {
      const time = c.new_time ? new Date(c.new_time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
      text += `  ${c.type.toUpperCase()}: ${c.patient}`
      if (c.type === 'rescheduled' && c.previous_time) {
        const prev = new Date(c.previous_time).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
        text += ` (was ${prev} -> now ${time})`
      } else if (time) {
        text += ` at ${time}`
      }
      text += ` [${c.status}]${c.dob_verified ? ' (ID verified)' : ''}\n`
    }
  }

  text += `\nTomorrow's Schedule (${s.tomorrow_appointments} appointment${s.tomorrow_appointments !== 1 ? 's' : ''}):\n`
  if (s.tomorrow_appointments === 0) {
    text += `  No appointments scheduled.\n`
  } else {
    for (const a of recap.tomorrow) {
      const time = new Date(a.time).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })
      text += `  ${time} - ${a.patient} (${a.duration}min)\n`
    }
  }

  return text
}

export async function GET(req: NextRequest) {
  try {
    const practiceId = await getPracticeId()
    if (!practiceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get today's changes
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const { data: changes } = await supabaseAdmin
      .from('schedule_changes')
      .select('*, patients(first_name, last_name, phone)')
      .eq('practice_id', practiceId)
      .gte('created_at', todayStart.toISOString())
      .order('created_at', { ascending: false })

    // Get tomorrow's appointments
    const tomorrowStart = new Date()
    tomorrowStart.setDate(tomorrowStart.getDate() + 1)
    tomorrowStart.setHours(0, 0, 0, 0)
    const tomorrowEnd = new Date(tomorrowStart)
    tomorrowEnd.setHours(23, 59, 59, 999)

    const { data: tomorrowAppts } = await supabaseAdmin
      .from('appointments')
      .select('*, patients(first_name, last_name)')
      .eq('practice_id', practiceId)
      .gte('scheduled_at', tomorrowStart.toISOString())
      .lte('scheduled_at', tomorrowEnd.toISOString())
      .neq('status', 'cancelled')
      .order('scheduled_at', { ascending: true })

    const recap = buildRecapData(changes || [], tomorrowAppts || [])

    return NextResponse.json({ recap })
  } catch (err) {
    console.error('[daily-recap GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — Send the recap (called by cron or manually)
// Can send for a specific practice or all practices with daily_recap_enabled
export async function POST(req: NextRequest) {
  try {
    // Auth: either cron secret or authenticated user
    const cronSecret = req.headers.get('x-cron-secret')
    const isAuthorizedCron = cronSecret === process.env.CRON_SECRET

    let practiceIds: string[] = []

    if (isAuthorizedCron) {
      // Cron: send for all practices with recap enabled
      const { data: practices } = await supabaseAdmin
        .from('practices')
        .select('id')
        .eq('daily_recap_enabled', true)

      practiceIds = (practices || []).map(p => p.id)
    } else {
      // Manual: send for user's practice only
      const practiceId = await getPracticeId()
      if (!practiceId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      practiceIds = [practiceId]
    }

    const results = []

    for (const pid of practiceIds) {
      try {
        // Get practice details
        const { data: practice } = await supabaseAdmin
          .from('practices')
          .select('*, notification_emails, daily_recap_method')
          .eq('id', pid)
          .single()

        if (!practice) continue

        // Get today's changes
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)

        const { data: changes } = await supabaseAdmin
          .from('schedule_changes')
          .select('*, patients(first_name, last_name, phone)')
          .eq('practice_id', pid)
          .gte('created_at', todayStart.toISOString())

        // Get tomorrow's appointments
        const tomorrowStart = new Date()
        tomorrowStart.setDate(tomorrowStart.getDate() + 1)
        tomorrowStart.setHours(0, 0, 0, 0)
        const tomorrowEnd = new Date(tomorrowStart)
        tomorrowEnd.setHours(23, 59, 59, 999)

        const { data: tomorrowAppts } = await supabaseAdmin
          .from('appointments')
          .select('*, patients(first_name, last_name)')
          .eq('practice_id', pid)
          .gte('scheduled_at', tomorrowStart.toISOString())
          .lte('scheduled_at', tomorrowEnd.toISOString())
          .neq('status', 'cancelled')
          .order('scheduled_at', { ascending: true })

        const recap = buildRecapData(changes || [], tomorrowAppts || [])
        const recapText = formatRecapText(recap, practice.name, practice.ai_name || 'Ellie')

        const method = practice.daily_recap_method || 'email'

        // Send via email
        if ((method === 'email' || method === 'both') && practice.notification_emails?.length) {
          // TODO: Send via Resend to practice.notification_emails
          console.log(`[daily-recap] Would email recap to ${practice.notification_emails.join(', ')}`)
        }

        // Send via SMS
        if ((method === 'sms' || method === 'both') && practice.therapist_phone) {
          // TODO: Send via Twilio to practice.therapist_phone
          console.log(`[daily-recap] Would SMS recap to ${practice.therapist_phone}`)
        }

        // Mark changes as included in recap
        if (changes?.length) {
          await supabaseAdmin
            .from('schedule_changes')
            .update({ included_in_recap: true })
            .in('id', changes.map(c => c.id))
        }

        // Log the recap
        await supabaseAdmin.from('daily_recaps').insert({
          practice_id: pid,
          delivery_method: method,
          changes_count: changes?.length || 0,
          tomorrow_count: tomorrowAppts?.length || 0,
          recap_data: recap,
        })

        results.push({ practice_id: pid, sent: true, changes: changes?.length || 0 })
      } catch (err) {
        console.error(`[daily-recap] Error for practice ${pid}:`, err)
        results.push({ practice_id: pid, sent: false, error: String(err) })
      }
    }

    return NextResponse.json({ results })
  } catch (err) {
    console.error('[daily-recap POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
