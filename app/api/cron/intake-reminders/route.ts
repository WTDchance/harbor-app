// app/api/cron/intake-reminders/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * Called by an external cron (cron-job.org) every hour.
 * Sends reminders for incomplete intake items after 24h, 48h, 96h.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 */
const REMINDER_HOURS = [24, 48, 96] // cadence
const MAX_REMINDERS = 3

async function sendReminder(item: any) {
  // Calls the existing /api/intake/send endpoint to re-send.
  // For now we log + mark the timestamp; wiring to Twilio/Resend happens
  // through the already-working /api/intake/send pipeline.
  try {
    const base = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
    await fetch(`${base}/api/intake/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        patient_id: item.patient_id,
        practice_id: item.practice_id,
        reminder: true,
        packet_item_id: item.id,
      }),
    })
  } catch (err) {
    console.error('[cron reminder send]', err)
  }
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const now = Date.now()
    const { data: items, error } = await supabaseAdmin
      .from('intake_packet_items')
      .select('*')
      .in('status', ['pending', 'sent', 'opened'])
      .lt('reminder_count', MAX_REMINDERS)
    if (error) throw error

    let sent = 0
    for (const item of items ?? []) {
      const anchor = item.last_reminder_at
        ? new Date(item.last_reminder_at).getTime()
        : item.sent_at
          ? new Date(item.sent_at).getTime()
          : new Date(item.created_at).getTime()
      const hoursSince = (now - anchor) / (1000 * 60 * 60)
      const targetHours = REMINDER_HOURS[item.reminder_count] ?? MAX_REMINDERS * 24
      if (hoursSince < targetHours) continue

      await sendReminder(item)
      await supabaseAdmin
        .from('intake_packet_items')
        .update({
          reminder_count: (item.reminder_count ?? 0) + 1,
          last_reminder_at: new Date().toISOString(),
        })
        .eq('id', item.id)
      sent += 1
    }

    return NextResponse.json({ ok: true, considered: items?.length ?? 0, sent })
  } catch (err: any) {
    console.error('[cron reminders]', err)
    return NextResponse.json({ error: err.message || 'internal error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  // Allow GET for cron services that prefer it; same auth.
  return POST(req)
}
