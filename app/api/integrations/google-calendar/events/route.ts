import { supabaseAdmin } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import { refreshAccessToken } from '@/lib/googleCalendar'
import { resolvePracticeIdForApi } from '@/lib/active-practice'
import { requireApiSession } from '@/lib/aws/api-auth'

async function getPracticeId(): Promise<string | null> {
  // supabase client removed (Cognito auth)
  const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) return null
  return resolvePracticeIdForApi(supabaseAdmin, user)
}

interface GoogleCalendarEvent {
  id: string
  summary: string
  description?: string
  start: { dateTime?: string; date?: string }
  end: { dateTime?: string; date?: string }
  location?: string
}

interface NormalizedEvent {
  id: string
  title: string
  description?: string
  start: string
  end: string
  location?: string
}

export async function GET(req: NextRequest) {
  try {
    const practiceId = await getPracticeId()
    if (!practiceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: connection, error: connError } = await supabaseAdmin
      .from('calendar_connections')
      .select('*')
      .eq('practice_id', practiceId)
      .eq('provider', 'google')
      .single()

    if (connError || !connection) {
      return NextResponse.json(
        { error: 'Google Calendar not connected' },
        { status: 404 }
      )
    }

    let accessToken = connection.access_token

    // Check if token is expired and refresh if needed
    if (connection.token_expires_at) {
      const expiresAt = new Date(connection.token_expires_at).getTime()
      if (expiresAt < Date.now()) {
        if (!connection.refresh_token) {
          return NextResponse.json(
            { error: 'Google Calendar token expired and cannot be refreshed' },
            { status: 401 }
          )
        }

        const refreshResult = await refreshAccessToken(connection.refresh_token, practiceId)
        if (!refreshResult) {
          return NextResponse.json(
            { error: 'Failed to refresh Google Calendar token' },
            { status: 500 }
          )
        }
        accessToken = refreshResult.access_token
      }
    }

    const now = new Date().toISOString()
    const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    const eventsResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(now)}&timeMax=${encodeURIComponent(timeMax)}&showDeleted=false&singleEvents=true&orderBy=startTime`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    )

    if (!eventsResponse.ok) {
      if (eventsResponse.status === 401) {
        return NextResponse.json(
          { error: 'Google Calendar token invalid' },
          { status: 401 }
        )
      }
      throw new Error(`Google Calendar API error: ${eventsResponse.statusText}`)
    }

    const data = await eventsResponse.json()
    const events: NormalizedEvent[] = (data.items || []).map((event: GoogleCalendarEvent) => ({
      id: event.id,
      title: event.summary || 'Untitled',
      description: event.description,
      start: event.start.dateTime || event.start.date || '',
      end: event.end.dateTime || event.end.date || '',
      location: event.location
    }))

    return NextResponse.json({ events })
  } catch (err) {
    console.error('[google-calendar/events GET]', err)
    return NextResponse.json({ error: 'Failed to fetch calendar events' }, { status: 500 })
  }
        }
