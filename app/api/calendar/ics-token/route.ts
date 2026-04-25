// Calendar ICS subscribe URL.
//
// AWS-side simplification: the legacy code maintained two parallel token
// systems on practices (calendar_token + ics_feed_token). We unify around
// calendar_token — same value drives /api/calendar/feed and any subscribe
// URLs the dashboard surfaces. One token, one feed.
//
// On AWS the canonical subscribe URL is /api/calendar/feed?token=<token>.
// The legacy /api/calendar/ics/<token> path is served by /api/calendar/feed
// — clients that already subscribed via the legacy URL keep working
// because Apple/Google calendars only follow the URL the user pasted in
// (we just don't surface the old path here anymore).
//
// GET → returns webcal:// + https:// URLs, lazy-creating a token if the
//        practice doesn't have one yet.
// POST → 501 (token rotation deferred to phase-4b).

import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function publicAppUrl(): string {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '')
    .replace(/\/$/, '')
}

export async function GET() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) {
    return NextResponse.json({ error: 'no_practice' }, { status: 404 })
  }

  // Fetch existing token, lazy-create if missing.
  const lookup = await pool.query(
    `SELECT calendar_token FROM practices WHERE id = $1 LIMIT 1`,
    [ctx.practiceId],
  )
  let token: string | null = lookup.rows[0]?.calendar_token ?? null

  if (!token) {
    token = randomBytes(24).toString('base64url')
    await pool.query(
      `UPDATE practices SET calendar_token = $1 WHERE id = $2`,
      [token, ctx.practiceId],
    ).catch(err => console.error('[ics-token] lazy-create failed', err))
  }

  const base = publicAppUrl()
  const httpsUrl = `${base}/api/calendar/feed?token=${token}`
  const webcalUrl = httpsUrl.replace(/^https?:\/\//, 'webcal://')

  return NextResponse.json({
    https_url: httpsUrl,
    webcal_url: webcalUrl,
    revoked: false,
  })
}

// TODO(phase-4b): port POST. Token rotation kicks every existing
// calendar-app subscriber off the feed, so it wants a confirm dialog +
// audit row co-deployed.
export async function POST() {
  return NextResponse.json(
    { error: 'ics_token_rotate_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
