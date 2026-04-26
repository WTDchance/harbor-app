// Google Calendar connection status + disconnect.
// GET: { connected, email, calendar_id }.
// DELETE: tear down the connection row. Legacy practices.google_calendar_*
// columns are nulled if present (defensive — they may not exist on the
// AWS canonical schema).

import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // calendar_connections is the source of truth on AWS.
  const { rows } = await pool.query(
    `SELECT id, connected_email, access_token, refresh_token,
            token_expires_at, sync_enabled, created_at
       FROM calendar_connections
      WHERE practice_id = $1 AND provider = 'google'
      ORDER BY created_at DESC LIMIT 1`,
    [ctx.practiceId],
  ).catch(() => ({ rows: [] as any[] }))
  const conn = rows[0]
  if (conn?.access_token) {
    return NextResponse.json({
      connected: true,
      email: conn.connected_email || null,
      calendar_id: 'primary',
    })
  }

  // Legacy fallback (defensive on missing columns).
  try {
    const { rows: pr } = await pool.query(
      `SELECT google_calendar_email, google_calendar_id, google_calendar_token
         FROM practices WHERE id = $1 LIMIT 1`,
      [ctx.practiceId],
    )
    const p = pr[0]
    const legacyConnected = !!(p?.google_calendar_token && p?.google_calendar_email)
    return NextResponse.json({
      connected: legacyConnected,
      email: p?.google_calendar_email || null,
      calendar_id: p?.google_calendar_id || 'primary',
    })
  } catch {
    return NextResponse.json({ connected: false, email: null, calendar_id: null })
  }
}

export async function DELETE() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await pool.query(
    `DELETE FROM calendar_connections
      WHERE practice_id = $1 AND provider = 'google'`,
    [ctx.practiceId],
  ).catch(() => {})

  // Legacy column null-out (defensive — columns may not exist on canonical).
  pool.query(
    `UPDATE practices
        SET google_calendar_token = NULL, google_calendar_email = NULL
      WHERE id = $1`,
    [ctx.practiceId],
  ).catch(() => {})

  return NextResponse.json({ success: true })
}
