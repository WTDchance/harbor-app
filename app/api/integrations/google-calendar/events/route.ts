// Google Calendar — list upcoming 30d of events for the connected practice.
// Auto-refreshes the access token via inline refresh helper if expired.

import { NextResponse, type NextRequest } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface GoogleEvent {
  id: string
  summary?: string
  description?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  location?: string
}

async function refreshGoogleToken(refreshToken: string, practiceId: string): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        refresh_token: refreshToken, grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) {
      console.error('[google-calendar/events] refresh failed', await res.text().catch(() => ''))
      return null
    }
    const data = await res.json() as { access_token: string; expires_in: number }
    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()
    await pool.query(
      `UPDATE calendar_connections
          SET access_token = $1, token_expires_at = $2, updated_at = NOW()
        WHERE practice_id = $3 AND provider = 'google'`,
      [data.access_token, expiresAt, practiceId],
    ).catch(() => {})
    return data.access_token
  } catch (err) {
    console.error('[google-calendar/events] refresh error', (err as Error).message)
    return null
  }
}

export async function GET(_req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { rows } = await pool.query(
    `SELECT access_token, refresh_token, token_expires_at
       FROM calendar_connections
      WHERE practice_id = $1 AND provider = 'google' LIMIT 1`,
    [ctx.practiceId],
  ).catch(() => ({ rows: [] as any[] }))
  const conn = rows[0]
  if (!conn) {
    return NextResponse.json({ error: 'Google Calendar not connected' }, { status: 404 })
  }

  let accessToken: string | null = conn.access_token
  if (conn.token_expires_at && new Date(conn.token_expires_at).getTime() < Date.now()) {
    if (!conn.refresh_token) {
      return NextResponse.json(
        { error: 'Google Calendar token expired and cannot be refreshed' },
        { status: 401 },
      )
    }
    accessToken = await refreshGoogleToken(conn.refresh_token, ctx.practiceId)
    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to refresh Google Calendar token' }, { status: 500 })
    }
  }

  const now = new Date().toISOString()
  const timeMax = new Date(Date.now() + 30 * 86_400_000).toISOString()
  const eventsRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
    `timeMin=${encodeURIComponent(now)}&timeMax=${encodeURIComponent(timeMax)}` +
    `&showDeleted=false&singleEvents=true&orderBy=startTime`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )

  if (!eventsRes.ok) {
    if (eventsRes.status === 401) {
      return NextResponse.json({ error: 'Google Calendar token invalid' }, { status: 401 })
    }
    return NextResponse.json(
      { error: `Google Calendar API error: ${eventsRes.statusText}` },
      { status: 502 },
    )
  }

  const data = await eventsRes.json() as { items?: GoogleEvent[] }
  const events = (data.items ?? []).map(event => ({
    id: event.id,
    title: event.summary || 'Untitled',
    description: event.description,
    start: event.start?.dateTime || event.start?.date || '',
    end: event.end?.dateTime || event.end?.date || '',
    location: event.location,
  }))
  return NextResponse.json({ events })
}
