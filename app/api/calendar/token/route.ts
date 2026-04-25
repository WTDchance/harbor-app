// Returns the practice's calendar_token + the public ICS subscription URL
// (/api/calendar/feed?token=…). Used by the settings page to display the
// "Subscribe in your calendar app" link.
//
// POST (rotation) is held for phase-4b — rotation invalidates anyone
// currently subscribed, so we want a deliberate UI flow + audit row.

import { NextResponse } from 'next/server'
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
  if (!ctx.practiceId) return NextResponse.json({ token: null })

  const { rows } = await pool
    .query(
      `SELECT calendar_token FROM practices WHERE id = $1 LIMIT 1`,
      [ctx.practiceId],
    )
    .catch(() => ({ rows: [] as any[] }))

  const token = rows[0]?.calendar_token ?? null
  if (!token) return NextResponse.json({ token: null })

  return NextResponse.json({
    token,
    feedUrl: `${publicAppUrl()}/api/calendar/feed?token=${token}`,
  })
}

// TODO(phase-4b): port POST. Rotates calendar_token (32 hex chars).
// Rotation breaks any existing calendar app subscription, so the UI
// confirmation flow + an audit_logs entry should land together.
export async function POST() {
  return NextResponse.json(
    { error: 'calendar_token_rotate_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
