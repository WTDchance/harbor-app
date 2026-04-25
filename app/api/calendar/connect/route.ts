// Apple Calendar (CalDAV) connection management.
//
// GET → status of the practice's Apple Calendar connection (read-only;
//        returns whether it's connected + which Apple ID is on file).
// POST / DELETE → connect/disconnect, both involve writing CalDAV
//        credentials and validating against iCloud via PROPFIND. Held
//        for phase-4b alongside the other calendar write paths.

import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ connected: false, username: null })

  const { rows } = await pool
    .query(
      `SELECT id, provider, label, caldav_username, sync_enabled, last_synced_at,
              created_at, updated_at
         FROM calendar_connections
        WHERE practice_id = $1 AND provider = 'apple'
        LIMIT 1`,
      [ctx.practiceId],
    )
    .catch(() => ({ rows: [] as any[] }))

  const conn = rows[0]
  if (!conn) return NextResponse.json({ connected: false, username: null })

  return NextResponse.json({
    connected: true,
    id: conn.id,
    username: conn.caldav_username,
    label: conn.label,
    sync_enabled: conn.sync_enabled,
    last_synced_at: conn.last_synced_at,
    created_at: conn.created_at,
    updated_at: conn.updated_at,
  })
}

// TODO(phase-4b): port POST. Validates iCloud creds via PROPFIND, then
// upserts calendar_connections row. App-specific password handling +
// calendar-count discovery.
export async function POST() {
  return NextResponse.json(
    { error: 'calendar_connect_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}

// TODO(phase-4b): port DELETE. Disconnect = delete the row. Trivial port,
// held back so the disconnect flow can be tested alongside the connect
// flow as a single atomic batch.
export async function DELETE() {
  return NextResponse.json(
    { error: 'calendar_disconnect_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
