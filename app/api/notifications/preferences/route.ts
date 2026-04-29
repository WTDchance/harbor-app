// app/api/notifications/preferences/route.ts
//
// Wave 23 (AWS port). Browser/email notification preferences for the
// caller's practice. Cognito + pool. Stored on practices row as
// notification_preferences JSONB.
//
// Wave 50 (SMS reminder pipeline) — also surfaces the per-USER SMS
// toggles from user_notification_preferences:
//   sms_appointment_reminders_enabled
//   sms_cancellation_fill_enabled
//   sms_two_factor_enabled
//
// The user-level prefs are upserted on PATCH so a user with no row yet
// gets one created the first time they touch the settings page.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { getEffectivePracticeId } from '@/lib/active-practice'

const DEFAULT_PRACTICE_PREFS = {
  email_calls: true,
  email_intakes: true,
  email_reminders: false,
  push_calls: true,
  push_intakes: false,
  push_reminders: false,
}

const DEFAULT_SMS_PREFS = {
  sms_appointment_reminders_enabled: true,
  sms_cancellation_fill_enabled: true,
  sms_two_factor_enabled: true,
}

async function loadSmsPrefs(userId: string): Promise<typeof DEFAULT_SMS_PREFS> {
  try {
    const { rows } = await pool.query(
      `SELECT sms_appointment_reminders_enabled,
              sms_cancellation_fill_enabled,
              sms_two_factor_enabled
         FROM user_notification_preferences
        WHERE user_id = $1
        LIMIT 1`,
      [userId],
    )
    if (rows.length === 0) return DEFAULT_SMS_PREFS
    return {
      sms_appointment_reminders_enabled: rows[0].sms_appointment_reminders_enabled !== false,
      sms_cancellation_fill_enabled: rows[0].sms_cancellation_fill_enabled !== false,
      sms_two_factor_enabled: rows[0].sms_two_factor_enabled !== false,
    }
  } catch {
    // Table missing on a fresh env — defaults are TRUE per the migration.
    return DEFAULT_SMS_PREFS
  }
}

export async function GET(_req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let practicePrefs = DEFAULT_PRACTICE_PREFS
  try {
    const { rows } = await pool.query(
      `SELECT notification_preferences FROM practices WHERE id = $1 LIMIT 1`,
      [practiceId],
    )
    practicePrefs = rows[0]?.notification_preferences ?? DEFAULT_PRACTICE_PREFS
  } catch {
    /* fall through to defaults */
  }

  const smsPrefs = await loadSmsPrefs(ctx.user.id)

  return NextResponse.json({
    preferences: { ...practicePrefs, ...smsPrefs },
  })
}

export async function PATCH(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))

  // Split practice-level vs user-level columns
  const nextPracticePrefs = { ...DEFAULT_PRACTICE_PREFS }
  for (const k of Object.keys(DEFAULT_PRACTICE_PREFS) as (keyof typeof DEFAULT_PRACTICE_PREFS)[]) {
    if (k in body) (nextPracticePrefs as any)[k] = !!body[k]
  }

  const nextSmsPrefs = { ...DEFAULT_SMS_PREFS }
  for (const k of Object.keys(DEFAULT_SMS_PREFS) as (keyof typeof DEFAULT_SMS_PREFS)[]) {
    if (k in body) (nextSmsPrefs as any)[k] = !!body[k]
  }

  try {
    await pool.query(
      `UPDATE practices SET notification_preferences = $1::jsonb WHERE id = $2`,
      [JSON.stringify(nextPracticePrefs), practiceId],
    )
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }

  // User-level upsert. Best-effort — if user_notification_preferences
  // is missing on this env we fall back to the previously-loaded values.
  try {
    await pool.query(
      `INSERT INTO user_notification_preferences (
         user_id, practice_id,
         sms_appointment_reminders_enabled,
         sms_cancellation_fill_enabled,
         sms_two_factor_enabled,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id) DO UPDATE
         SET sms_appointment_reminders_enabled = EXCLUDED.sms_appointment_reminders_enabled,
             sms_cancellation_fill_enabled     = EXCLUDED.sms_cancellation_fill_enabled,
             sms_two_factor_enabled            = EXCLUDED.sms_two_factor_enabled,
             updated_at                         = now()`,
      [
        ctx.user.id,
        practiceId,
        nextSmsPrefs.sms_appointment_reminders_enabled,
        nextSmsPrefs.sms_cancellation_fill_enabled,
        nextSmsPrefs.sms_two_factor_enabled,
      ],
    )
  } catch (err) {
    console.error('[notifications/preferences] sms upsert failed:', (err as Error).message)
  }

  return NextResponse.json({
    ok: true,
    preferences: { ...nextPracticePrefs, ...nextSmsPrefs },
  })
}
