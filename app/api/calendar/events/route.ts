 import { createServerClient } from '@supabase/ssr'   
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import { createDAVClient } from 'tsdav'

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
  const { data } = await supabaseAdmin.from('users').select('practice_id').eq('id', user.id).single()
  return data?.practice_id || null
}

interface CalDAVEvent {
  id?: string
  summary: string
  description?: string
  startDate: string
  endDate: string
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
      .eq('provider', 'apple')
      .single()

    if (connError || !connection) {
      return NextResponse.json(
        { error: 'Apple Calendar not connected' },
        { status: 404 }
      )
    }

    if (!connection.caldav_username || !connection.caldav_password || !connection.caldav_url) {
      return NextResponse.json(
        { error: 'Incomplete CalDAV credentials' },
        { status: 400 }
      )
    }

    const client = await createDAVClient({
      serverUrl: connection.caldav_url,
      credentials: {
        username: connection.caldav_username,
        password: connection.caldav_password
      },
      authType: 'basic',
      defaultAccountType: 'caldav'
    })

    const calendars = await client.fetchCalendars()
    if (!calendars || calendars.length === 0) {
      return NextResponse.json({ events: [] })
    }

    const objects = await client.fetchCalendarObjects({ calendar: calendars[0] })

    const events = objects.map((obj) => ({
      id: obj.url,
      summary: obj.summary || 'Untitled',
      description: obj.description,
      startDate: obj.startDate,
      endDate: obj.endDate,
      location: obj.location
    }))

    return NextResponse.json({ events })
  } catch (err) {feat: add Apple CalDAV events support
    console.error('[calendar/events GET]', err)
    return NextResponse.json({ error: 'Failed to fetch calendar events' }, { status: 500 })
  }
}

interface CreateEventBody {
  summary: string
  description?: string
  startDate: string
  endDate: string
  location?: string
}

export async function POST(req: NextRequest) {
  try {
    const practiceId = await getPracticeId()
    if (!practiceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: CreateEventBody = await req.json()
    const { summary, description, startDate, endDate, location } = body

    if (!summary || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'summary, startDate, and endDate are required' },
        { status: 400 }
      )
    }

    const { data: connection, error: connError } = await supabaseAdmin
      .from('calendar_connections')
      .select('*')
      .eq('practice_id', practiceId)
      .eq('provider', 'apple')
      .single()

    if (connError || !connection) {
      return NextResponse.json(
        { error: 'Apple Calendar not connected' },
        { status: 404 }
      )
    }

    const client = await createDAVClient({
      serverUrl: connection.caldav_url!,
      credentials: {
        username: connection.caldav_username!,
        password: connection.caldav_password!
      },
      authType: 'basic',
      defaultAccountType: 'caldav'
    })

    const calendars = await client.fetchCalendars()
    if (!calendars || calendars.length === 0) {
      return NextResponse.json(
        { error: 'No calendars found' },
        { status: 404 }
      )
    }

    const iCalString = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Harbor//Calendar//EN',
      'BEGIN:VEVENT',
      `UID:${Date.now()}@harborreceptionist.com`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
      `DTSTART:${startDate.replace(/[-:]/g, '').split('.')[0]}Z`,
      `DTEND:${endDate.replace(/[-:]/g, '').split('.')[0]}Z`,
      `SUMMARY:${summary}`,
      ...(description ? [`DESCRIPTION:${description}`] : []),
      ...(location ? [`LOCATION:${location}`] : []),
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')

    const event = await client.createCalendarObject({
      calendar: calendars[0],
      filename: `${Date.now()}.ics`,
      iCalString
    })

    return NextResponse.json({ event }, { status: 201 })
  } catch (err) {
    console.error('[calendar/events POST]', err)
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 })
  }
      }
