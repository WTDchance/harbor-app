// app/api/notifications/preferences/route.ts
//
// Wave 23 (AWS port). Browser/email notification preferences for the
// caller's practice. Cognito + pool. Stored on practices row as
// notification_preferences JSONB.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { getEffectivePracticeId } from '@/lib/active-practice'

const DEFAULT_PREFS = {
  email_calls: true,
  email_intakes: true,
  email_reminders: false,
  push_calls: true,
  push_intakes: false,
  push_reminders: false,
}

export async function GET(_req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { rows } = await pool.query(
      `SELECT notification_preferences FROM practices WHERE id = $1 LIMIT 1`,
      [practiceId],
    )
    return NextResponse.json({
      preferences: rows[0]?.notification_preferences ?? DEFAULT_PREFS,
    })
  } catch {
    return NextResponse.json({ preferences: DEFAULT_PREFS })
  }
}

export async function PATCH(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const next = { ...DEFAULT_PREFS, ...(body || {}) }

  try {
    await pool.query(
      `UPDATE practices SET notification_preferences = $1::jsonb WHERE id = $2`,
      [JSON.stringify(next), practiceId],
    )
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, preferences: next })
}
