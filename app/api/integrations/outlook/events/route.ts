import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import { resolvePracticeIdForApi } from '@/lib/active-practice'

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
  return resolvePracticeIdForApi(supabaseAdmin, user)
}

interface MicrosoftGraphEvent {
  id: string
  subject: string
  bodyPreview?: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  location?: { displayName: string }
  isReminderOn: boolean
}

interface NormalizedEvent {
  id: string
  title: string
  description?: string
  start: string
  end: string
  location?: string
}

async function refreshOutlookToken(
  refreshToken: string,
  practiceId: string
): Promise<{ access_token: string } | null> {
  try {
    const clientId = process.env.MICROSOFT_CLIENT_ID
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      console.error('[refreshOutlookToken] Microsoft credentials not configured')
      return null
    }

    const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'openid profile email Calendars.ReadWrite offline_access'
      })
    })

    if (!response.ok) {
      console.error('[refreshOutlookToken] Token refresh failed:', await response.text())
      return null
    }

    const data = await response.json()
    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()

    // Update the stored token
    await supabaseAdmin
      .from('calendar_connections')
      .update({
        access_token: data.access_token,
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString()
      })
      .eq('practice_id', practiceId)
      .eq('provider', 'outlook')

    return { access_token: data.access_token }
  } catch (err) {
    console.error('[refreshOutlookToken]', err)
    return null
  }
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
      .eq('provider', 'outlook')
      .single()

    if (connError || !connection) {
      return NextResponse.json(
        { error: 'Outlook Calendar not connected' },
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
            { error: 'Outlook Calendar token expired and cannot be refreshed' },
            { status: 401 }
          )
        }

        const refreshResult = await refreshOutlookToken(connection.refresh_token, practiceId)
        if (!refreshResult) {
          return NextResponse.json(
            { error: 'Failed to refresh Outlook Calendar token' },
            { status: 500 }
          )
        }
        accessToken = refreshResult.access_token
      }
    }

    const now = new Date().toISOString()
    const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    const eventsResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${encodeURIComponent(now)}&endDateTime=${encodeURIComponent(timeMax)}&\$orderby=start/dateTime`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    )

    if (!eventsResponse.ok) {
      if (eventsResponse.status === 401) {
        return NextResponse.json(
          { error: 'Outlook Calendar token invalid' },
          { status: 401 }
        )
      }
      throw new Error(`Microsoft Graph API error: ${eventsResponse.statusText}`)
    }

    const data = await eventsResponse.json()
    const events: NormalizedEvent[] = (data.value || []).map((event: MicrosoftGraphEvent) => ({
      id: event.id,
      title: event.subject || 'Untitled',
      description: event.bodyPreview,
      start: event.start.dateTime,
      end: event.end.dateTime,
      location: event.location?.displayName
    }))

    return NextResponse.json({ events })
  } catch (err) {
    console.error('[outlook/events GET]', err)
    return NextResponse.json({ error: 'Failed to fetch calendar events' }, { status: 500 })
  }
  }
