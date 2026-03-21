import { supabaseAdmin } from '@/lib/supabase'

interface CalendarToken {
    access_token: string
    refresh_token: string
    expiry_date: number
    token_type: string
  }

async function refreshAccessToken(token: CalendarToken, practiceId: string): Promise<string> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
                  client_id: process.env.GOOGLE_CLIENT_ID!,
                  client_secret: process.env.GOOGLE_CLIENT_SECRET!,
                  refresh_token: token.refresh_token,
                  grant_type: 'refresh_token',
                }),
        })
    const data = await res.json()
    const newToken = {
          ...token,
          access_token: data.access_token,
          expiry_date: Date.now() + (data.expires_in * 1000),
        }
    await supabaseAdmin.from('practices').update({ google_calendar_token: newToken }).eq('id', practiceId)
    return data.access_token
  }

async function getAccessToken(practiceId: string): Promise<string | null> {
    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('google_calendar_token')
      .eq('id', practiceId)
      .single()

    if (!practice?.google_calendar_token) return null

    const token = practice.google_calendar_token as CalendarToken
    if (Date.now() >= token.expiry_date - 60000) {
          return refreshAccessToken(token, practiceId)
        }
    return token.access_token
  }

export async function getCalendarEvents(
    practiceId: string,
    calendarId: string = 'primary',
    timeMin: string,
    timeMax: string
  ): Promise<any[]> {
    const accessToken = await getAccessToken(practiceId)
    if (!accessToken) return []

    const params = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: 'true',
          orderBy: 'startTime',
        })

    const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        )

    if (!res.ok) return []
    const data = await res.json()
    return data.items || []
  }

export async function createCalendarEvent(
    practiceId: string,
    calendarId: string = 'primary',
    event: {
          summary: string
          description?: string
          start: string
          end: string
          attendeeEmail?: string
        }
  ): Promise<any | null> {
    const accessToken = await getAccessToken(practiceId)
    if (!accessToken) return null

    const eventBody: any = {
          summary: event.summary,
          description: event.description || '',
          start: { dateTime: event.start, timeZone: 'America/New_York' },
          end: { dateTime: event.end, timeZone: 'America/New_York' },
        }

    if (event.attendeeEmail) {
          eventBody.attendees = [{ email: event.attendeeEmail }]
        }

    const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
          {
                  method: 'POST',
                  headers: {
                            Authorization: `Bearer ${accessToken}`,
                            'Content-Type': 'application/json',
                          },
                  body: JSON.stringify(eventBody),
                }
        )

    if (!res.ok) {
          console.error('Failed to create calendar event:', await res.text())
          return null
        }
    return res.json()
  }

export async function checkAvailability(
    practiceId: string,
    calendarId: string = 'primary',
    start: string,
    end: string
  ): Promise<boolean> {
    const events = await getCalendarEvents(practiceId, calendarId, start, end)
    return events.length === 0
  }

export async function getUpcomingEvents(
    practiceId: string,
    calendarId: string = 'primary',
    days: number = 7
  ): Promise<any[]> {
    const now = new Date()
    const future = new Date()
    future.setDate(future.getDate() + days)
    return getCalendarEvents(
          practiceId,
          calendarId,
          now.toISOString(),
          future.toISOString()
        )
  }
