// app/api/cron/intake-reminders/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { assertCronAuthorized } from '@/lib/cron-auth'

/**
 * Called by an external cron (cron-job.org) every hour.
 * Sends reminders for incomplete intake forms after 24h, 48h, 96h.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 *
 * Previously this queried `intake_packet_items` (a table nothing writes to
 * in production) and POSTed to /api/intake/send without any contact info,
 * so no reminder ever actually went out. We now drive reminders off of
 * `intake_forms` — the same table that /api/intake/send writes to — and
 * re-use the existing token via /api/intake/resend.
 */
const REMINDER_HOURS = [24, 48, 96] // cadence
const MAX_REMINDERS = 3

async function sendReminder(form: any) {
  try {
    const base = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
    // Let the resend endpoint auto-select the widest delivery method that
    // matches the contact info on file (email-only, sms-only, or both).
    const res = await fetch(`${base}/api/intake/resend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intake_form_id: form.id }),
    })
    if (!res.ok) {
      const txt = await res.text()
      console.error('[cron reminder] resend failed', res.status, txt)
    }
  } catch (err) {
    console.error('[cron reminder send]', err)
  }
}

export async function POST(req: NextRequest) {
  const unauthorized = assertCronAuthorized(req)
  if (unauthorized) return unauthorized

  try {
    const now = Date.now()
    const { data: forms, error } = await supabaseAdmin
      .from('intake_forms')
      .select(
        'id, status, reminder_count, last_reminder_at, email_sent_at, sms_sent_at, created_at, expires_at, patient_email, patient_phone'
      )
      .in('status', ['pending', 'sent', 'opened'])
      .lt('reminder_count', MAX_REMINDERS)

    if (error) throw error

    let sent = 0
    for (const form of forms ?? []) {
      // Skip expired
      if (form.expires_at && new Date(form.expires_at).getTime() < now) continue
      // Need at least one channel we can reach them on
      if (!form.patient_email && !form.patient_phone) continue

      const anchor = form.last_reminder_at
        ? new Date(form.last_reminder_at).getTime()
        : form.email_sent_at
          ? new Date(form.email_sent_at).getTime()
          : form.sms_sent_at
            ? new Date(form.sms_sent_at).getTime()
            : new Date(form.created_at).getTime()

      const hoursSince = (now - anchor) / (1000 * 60 * 60)
      const targetHours = REMINDER_HOURS[form.reminder_count ?? 0] ?? MAX_REMINDERS * 24
      if (hoursSince < targetHours) continue

      await sendReminder(form)
      await supabaseAdmin
        .from('intake_forms')
        .update({
          reminder_count: (form.reminder_count ?? 0) + 1,
          last_reminder_at: new Date().toISOString(),
        })
        .eq('id', form.id)
      sent += 1
    }

    return NextResponse.json({ ok: true, considered: forms?.length ?? 0, sent })
  } catch (err: any) {
    console.error('[cron reminders]', err)
    return NextResponse.json({ error: err.message || 'internal error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  // Allow GET for cron services that prefer it; same auth.
  return POST(req)
}
