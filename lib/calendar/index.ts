// Provider-agnostic calendar interface for Harbor.
// Routes to Google Calendar OR Apple (CalDAV) based on the practice's
// calendar_connections row. If a practice has no connection, returns null.
//
// Used by the SMS AI agent so booking/reschedule/cancel work uniformly
// regardless of which calendar the practice uses.

import { supabaseAdmin } from '@/lib/supabase'
import { getValidAccessToken, getCalendarEvents } from '@/lib/googleCalendar'
import * as caldav from '@/lib/caldav'

export type Provider = 'google' | 'apple'

export interface NormalizedEvent {
  id: string          // google event id OR caldav event url
  title: string
  start: string       // ISO
  end: string         // ISO
  description?: string
  location?: string
  provider: Provider
}

export interface CalendarRouter {
  provider: Provider
  listEvents(start: Date, end: Date): Promise<NormalizedEvent[]>
  createEvent(ev: { summary: string; start: Date; end: Date; description?: string; location?: string }): Promise<{ id: string }>
  deleteEvent(id: string): Promise<void>
}

/**
 * Get a calendar router for a practice, or null if not connected.
 */
export async function getCalendarRouter(practiceId: string): Promise<CalendarRouter | null> {
  const { data: conn } = await supabaseAdmin
    .from('calendar_connections')
    .select('*')
    .eq('practice_id', practiceId)
    .maybeSingle()

  if (!conn) return null

  if (conn.provider === 'google') {
    return {
      provider: 'google',
      async listEvents(start, end) {
        const token = await getValidAccessToken(practiceId)
        if (!token) throw new Error('Google token unavailable')
        const events = await getCalendarEvents(token, practiceId, start, end)
        return events.map((e) => ({
          id: e.id,
          title: e.title,
          start: e.start,
          end: e.end,
          description: e.description,
          location: e.location,
          provider: 'google' as const,
        }))
      },
      async createEvent(ev) {
        const token = await getValidAccessToken(practiceId)
        if (!token) throw new Error('Google token unavailable')
        const resp = await fetch(
          'https://www.googleapis.com/calendar/v3/calendars/primary/events',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              summary: ev.summary,
              description: ev.description,
              location: ev.location,
              start: { dateTime: ev.start.toISOString() },
              end: { dateTime: ev.end.toISOString() },
            }),
          }
        )
        if (!resp.ok) throw new Error(`Google createEvent failed: ${resp.status}`)
        const data = await resp.json()
        return { id: data.id }
      },
      async deleteEvent(id) {
        const token = await getValidAccessToken(practiceId)
        if (!token) throw new Error('Google token unavailable')
        const resp = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
        )
        if (!resp.ok && resp.status !== 410) throw new Error(`Google deleteEvent failed: ${resp.status}`)
      },
    }
  }

  if (conn.provider === 'apple') {
    const creds = { username: conn.apple_username || conn.username, password: conn.apple_password || conn.password }
    if (!creds.username || !creds.password) return null

    const calendarUrl = conn.calendar_url || (await caldav.getDefaultCalendarUrl(creds))

    return {
      provider: 'apple',
      async listEvents(start, end) {
        const events = await caldav.getEvents(creds, calendarUrl, start, end)
        return events.map((e) => ({
          id: e.url,
          title: e.summary,
          start: e.dtstart,
          end: e.dtend,
          description: e.description,
          location: e.location,
          provider: 'apple' as const,
        }))
      },
      async createEvent(ev) {
        const { url } = await caldav.createEvent(creds, calendarUrl, ev)
        return { id: url }
      },
      async deleteEvent(id) {
        await caldav.deleteEvent(creds, id)
      },
    }
  }

  return null
}

/**
 * Find free slots between start/end for a given slot length in minutes.
 * Considers an "event" a busy block.
 */
export function findFreeSlots(
  events: NormalizedEvent[],
  start: Date,
  end: Date,
  slotMinutes: number,
  businessHours?: { startHour: number; endHour: number } // local hours, optional
): Array<{ start: Date; end: Date }> {
  const busy = events
    .map((e) => ({ start: new Date(e.start), end: new Date(e.end) }))
    .filter((b) => !isNaN(b.start.getTime()) && !isNaN(b.end.getTime()))
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  const slots: Array<{ start: Date; end: Date }> = []
  const slotMs = slotMinutes * 60 * 1000

  let cursor = new Date(start)
  while (cursor.getTime() + slotMs <= end.getTime()) {
    const candidateEnd = new Date(cursor.getTime() + slotMs)

    // Business hours filter
    if (businessHours) {
      const h = cursor.getHours()
      const eh = candidateEnd.getHours()
      if (h < businessHours.startHour || eh > businessHours.endHour) {
        cursor = new Date(cursor.getTime() + 30 * 60 * 1000)
        continue
      }
    }

    const overlaps = busy.some(
      (b) => cursor < b.end && candidateEnd > b.start
    )
    if (!overlaps) {
      slots.push({ start: new Date(cursor), end: candidateEnd })
    }
    cursor = new Date(cursor.getTime() + 30 * 60 * 1000)
  }
  return slots
}
