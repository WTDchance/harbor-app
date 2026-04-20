import { supabaseAdmin } from './supabase' 

export interface CalendarToken {
  access_token: string
  refresh_token?: string
  expiry_date?: string
  token_type: string
}

export interface GoogleCalendarEvent {
  id: string
  summary: string
  description?: string
  start: { dateTime?: string; date?: string }
  end: { dateTime?: string; date?: string }
  location?: string
}

export interface NormalizedEvent {
  id: string
  title: string
  description?: string
  start: string
  end: string
  location?: string
}

/**
 * Refreshes an expired Google Calendar access token
 * Updates the database with new token and expiry time
 */
export async function refreshAccessToken(
  refreshToken: string,
  practiceId: string
): Promise<CalendarToken | null> {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      console.error('[refreshAccessToken] Google credentials not configured')
      return null
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      }),
      // 4s cap on Google's oauth2 endpoint. Without this, a slow response
      // from Google would hang until Vapi's silence-timeout dropped the call
      // (seen on 4/19/26). withTimeout in webhook.ts is the outer safety net;
      // this is the inner one so we never even approach it.
      signal: AbortSignal.timeout(4000),
    })

    if (!response.ok) {
      console.error('[refreshAccessToken] Token refresh failed:', await response.text())
      return null
    }

    const data = await response.json()
    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()

    // Update the stored token in the database
    const { error } = await supabaseAdmin
      .from('calendar_connections')
      .update({
        access_token: data.access_token,
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString()
      })
      .eq('practice_id', practiceId)
      .eq('provider', 'google')

    if (error) {
      console.error('[refreshAccessToken] Database update failed:', error)
      return null
    }

    return {
      access_token: data.access_token,
      refresh_token: refreshToken,
      expiry_date: expiresAt,
      token_type: data.token_type || 'Bearer'
    }
  } catch (err) {
    console.error('[refreshAccessToken]', err)
    return null
  }
}

/**
 * Fetches calendar events from Google Calendar API within a time range
 * Handles token expiration and refresh automatically
 */
export async function getCalendarEvents(
  accessToken: string,
  practiceId: string,
  timeMin: Date = new Date(),
  timeMax: Date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
): Promise<NormalizedEvent[]> {
  try {
    const timeMinISO = timeMin.toISOString()
    const timeMaxISO = timeMax.toISOString()

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMinISO)}&timeMax=${encodeURIComponent(timeMaxISO)}&showDeleted=false&singleEvents=true&orderBy=startTime&maxResults=250`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(4000),
      }
    )

    if (!response.ok) {
      if (response.status === 401) {
        console.warn('[getCalendarEvents] Token expired for practice:', practiceId)
        throw new Error('Token expired')
      }
      throw new Error(`Google Calendar API error: ${response.statusText}`)
    }

    const data = await response.json()

    const events: NormalizedEvent[] = (data.items || []).map((event: GoogleCalendarEvent) => ({
      id: event.id,
      title: event.summary || 'Untitled',
      description: event.description,
      start: event.start.dateTime || event.start.date || '',
      end: event.end.dateTime || event.end.date || '',
      location: event.location
    }))

    return events
  } catch (err) {
    console.error('[getCalendarEvents]', err)
    throw err
  }
}

/**
 * Checks if a token needs refresh based on expiry time
 */
export function isTokenExpired(expiryDate?: string): boolean {
  if (!expiryDate) return false
  return new Date(expiryDate).getTime() < Date.now()
}

/**
 * Gets a valid access token, refreshing if necessary
 */
export async function getValidAccessToken(
  practiceId: string
): Promise<string | null> {
  try {
    const { data: connection, error } = await supabaseAdmin
      .from('calendar_connections')
      .select('access_token, refresh_token, token_expires_at')
      .eq('practice_id', practiceId)
      .eq('provider', 'google')
      .single()

    if (error || !connection) {
      console.error('[getValidAccessToken] Connection not found:', error)
      return null
    }

    if (isTokenExpired(connection.token_expires_at)) {
      if (!connection.refresh_token) {
        console.error('[getValidAccessToken] Token expired and no refresh token available')
        return null
      }

      const refreshed = await refreshAccessToken(connection.refresh_token, practiceId)
      return refreshed?.access_token || null
    }

    return connection.access_token
  } catch (err) {
    console.error('[getValidAccessToken]', err)
    return null
  }
}
