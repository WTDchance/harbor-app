// app/api/notifications/subscribe/route.ts
//
// Wave 23 (AWS port). Save a browser push subscription for the
// practice. Cognito + pool. Subscriptions table is keyed by
// (practice_id, endpoint) so re-subscribing replaces the old token.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { getEffectivePracticeId } from '@/lib/active-practice'

export async function POST(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sub = await req.json().catch(() => null)
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ error: 'invalid subscription' }, { status: 400 })
  }

  try {
    await pool.query(
      `INSERT INTO push_subscriptions
          (practice_id, endpoint, p256dh, auth, user_agent)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (practice_id, endpoint) DO UPDATE
          SET p256dh = EXCLUDED.p256dh,
              auth = EXCLUDED.auth,
              user_agent = EXCLUDED.user_agent,
              updated_at = NOW()`,
      [
        practiceId,
        sub.endpoint,
        sub.keys.p256dh,
        sub.keys.auth,
        req.headers.get('user-agent') ?? null,
      ],
    )
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { endpoint } = await req.json().catch(() => ({}))
  if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 })

  await pool.query(
    `DELETE FROM push_subscriptions WHERE practice_id = $1 AND endpoint = $2`,
    [practiceId, endpoint],
  )
  return NextResponse.json({ ok: true })
}
