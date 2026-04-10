// app/api/calendar/events/route.ts â Read/write events on connected Apple Calendar
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { getEvents, createEvent, deleteEvent, getDefaultCalendarUrl, listCalendars } from '@/lib/caldav'

// Helper: get practice ID from auth
async function getPracticeId(): Promise<string | null> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (s) => {
          try { s.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {}
        }
      }
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase.from('users').select('practice_id').eq('id', user.id).single()
  return data?.practice_id || null
}

// Helper: get Apple CalDAV credentials for practice
async function getAppleCredentials(practiceId: string) {
  const { data } = await supabaseAdmin
    .from('calendar_connections')
    .select('caldav_username, caldav_password, caldav_calendar_url')
    .eq('practice_id', practiceId)
    .eq('provider', 'apple')
    .single()

  if (!data?.caldav_username || !data?.caldav_password) return null
  return {
    username: data.caldav_username,
    password: data.caldav_password,
    calendarUrl: data.caldav_calendar_url || null,
  }
}

// GET /api/calendar/events?start=2026-04-09&end=2026-04-16&provider=apple
export async function GET(req: NextRequest) {
  try {
    const practiceId = await getPracticeId()
    if (!practiceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const provider = searchParams.get('provider') || 'apple'
    const startStr = searchParams.get('start')
    const endStr = searchParams.get('end')

    if (!startStr || !endStr) {
      return NextResponse.json({ error: 'start and end query params required (YYYY-MM-DD)' }, { status: 400 })
    }

    const start = new Date(startStr)
    const end = new Date(endStr)

    if (provider === 'apple') {
      const creds = await getAppleCredentials(practiceId)
      if (!creds) {
        return NextResponse.json({ error: 'Apple Calendar not connected. Go to Settings to connect.' }, { status: 404 })
      }

      // Get or discover calendar URL
      let calendarUrl = creds.calendarUrl
      if (!calendarUrl) {
        calendarUrl = await getDefaultCalendarUrl({ username: creds.username, password: creds.password })
        // Cache it for next time
        await supabaseAdmin
          .from('calendar_connections')
          .update({ caldav_calendar_url: calendarUrl })
          .eq('practice_id', practiceId)
          .eq('provider', 'apple')
      }

      const events = await getEvents(
        { username: creds.username, password: creds.password },
        calendarUrl,
        start,
        end
      )

      return NextResponse.json({
        provider: 'apple',
        events: events.map(e => ({
          uid: e.uid,
          summary: e.summary,
          start: e.dtstart,
          end: e.dtend,
          description: e.description,
          location: e.location,
        })),
      })
    }

    // For Google Calendar, use existing Google API flow
    return NextResponse.json({ error: `Provider "${provider}" not supported for events API yet` }, { status: 400 })

  } catch (err: any) {
    console.error('[Calendar Events GET]', err)
    return NextResponse.json({ error: err.message || 'Failed to fetch events' }, { status: 500 })
  }
}

// POST /api/calendar/events â Create event on Apple Calendar
export async function POST(req: NextRequest) {
  try {
    const practiceId = await getPracticeId()
    if (!practiceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { provider, summary, start, end, description, location } = await req.json()

    if (!summary || !start || !end) {
      return NextResponse.json({ error: 'summary, start, and end are required' }, { status: 400 })
    }

    if ((provider || 'apple') === 'apple') {
      const creds = await getAppleCredentials(practiceId)
      if (!creds) {
        return NextResponse.json({ error: 'Apple Calendar not connected' }, { status: 404 })
      }

      let calendarUrl = creds.calendarUrl
      if (!calendarUrl) {
        calendarUrl = await getDefaultCalendarUrl({ username: creds.username, password: creds.password })
        await supabaseAdmin
          .from('calendar_connections')
          .update({ caldav_calendar_url: calendarUrl })
          .eq('practice_id', practiceId)
          .eq('provider', 'apple')
      }

      const result = await createEvent(
        { username: creds.username, password: creds.password },
        calendarUrl,
        {
          summary,
          start: new Date(start),
          end: new Date(end),
          description,
          location,
        }
      )

      return NextResponse.json({ success: true, uid: result.uid })
    }

    return NextResponse.json({ error: `Provider "${provider}" not supported yet` }, { status: 400 })

  } catch (err: any) {
    console.error('[Calendar Events POST]', err)
    return NextResponse.json({ error: err.message || 'Failed to create event' }, { status: 500 })
  }
}

// DELETE /api/calendar/events?uid=xxx&provider=apple
export async function DELETE(req: NextRequest) {
  try {
    const practiceId = await getPracticeId()
    if (!practiceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const provider = searchParams.get('provider') || 'apple'
    const uid = searchParams.get('uid')

    if (!uid) {
      return NextResponse.json({ error: 'uid query param required' }, { status: 400 })
    }

    if (provider === 'apple') {
      const creds = await getAppleCredentials(practiceId)
      if (!creds) {
        return NextResponse.json({ error: 'Apple Calendar not connected' }, { status: 404 })
      }

      let calendarUrl = creds.calendarUrl
      if (!calendarUrl) {
        calendarUrl = await getDefaultCalendarUrl({ username: creds.username, password: creds.password })
      }

      const eventUrl = calendarUrl.replace(/\/$/, '') + `/${uid}.ics`
      await deleteEvent(
        { username: creds.username, password: creds.password },
        eventUrl
      )

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: `Provider "${provider}" not supported yet` }, { status: 400 })

  } catch (err: any) {
    console.error('[Calendar Events DELETE]', err)
    return NextResponse.json({ error: err.message || 'Failed to delete event' }, { status: 500 })
  }
}
