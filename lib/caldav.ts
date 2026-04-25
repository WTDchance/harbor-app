// lib/caldav.ts â Apple Calendar (CalDAV) client for Harbor
// Uses raw fetch + XML â no external dependencies needed

const CALDAV_BASE = 'https://caldav.icloud.com/'

interface CalDAVCredentials {
  username: string  // Apple ID email
  password: string  // App-specific password from appleid.apple.com
}

interface CalDAVCalendar {
  url: string
  displayName: string
  color?: string
}

interface CalDAVEvent {
  uid: string
  url: string
  summary: string
  dtstart: string
  dtend: string
  description?: string
  location?: string
  raw?: string  // raw iCalendar text
}

// ---- Auth helper ----
function authHeader(creds: CalDAVCredentials): string {
  return 'Basic ' + Buffer.from(creds.username + ':' + creds.password).toString('base64')
}

// ---- 1. Discover the user's principal URL ----
async function discoverPrincipal(creds: CalDAVCredentials): Promise<string> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:current-user-principal/>
  </D:prop>
</D:propfind>`

  const resp = await fetch(CALDAV_BASE, {
    method: 'PROPFIND',
    headers: {
      Authorization: authHeader(creds),
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: '0',
    },
    body,
    signal: AbortSignal.timeout(10000),
  })

  if (resp.status === 401) {
    throw new Error('Apple ID authentication failed. Use an app-specific password from appleid.apple.com.')
  }
  if (!resp.ok && resp.status !== 207) {
    throw new Error(`PROPFIND principal failed: ${resp.status}`)
  }

  const xml = await resp.text()
  const match = xml.match(/<D:href[^>]*>([^<]+)<\/D:href>/i)
  if (!match) {
    // Try alternate namespace pattern
    const altMatch = xml.match(/<href[^>]*>([^<]+)<\/href>/i)
    if (!altMatch) throw new Error('Could not discover CalDAV principal URL')
    return new URL(altMatch[1], CALDAV_BASE).href
  }
  return new URL(match[1], CALDAV_BASE).href
}

// ---- 2. Discover calendar home set ----
async function discoverCalendarHome(creds: CalDAVCredentials, principalUrl: string): Promise<string> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <C:calendar-home-set/>
  </D:prop>
</D:propfind>`

  const resp = await fetch(principalUrl, {
    method: 'PROPFIND',
    headers: {
      Authorization: authHeader(creds),
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: '0',
    },
    body,
    signal: AbortSignal.timeout(10000),
  })

  if (!resp.ok && resp.status !== 207) {
    throw new Error(`PROPFIND calendar-home failed: ${resp.status}`)
  }

  const xml = await resp.text()
  const match = xml.match(/<C:calendar-home-set[^>]*>\s*<D:href[^>]*>([^<]+)<\/D:href>/is)
  if (!match) {
    const altMatch = xml.match(/calendar-home-set[^>]*>\s*<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/is)
    if (!altMatch) throw new Error('Could not discover calendar home set')
    return new URL(altMatch[1], CALDAV_BASE).href
  }
  return new URL(match[1], CALDAV_BASE).href
}

// ---- 3. List calendars ----
export async function listCalendars(creds: CalDAVCredentials): Promise<CalDAVCalendar[]> {
  const principalUrl = await discoverPrincipal(creds)
  const homeUrl = await discoverCalendarHome(creds, principalUrl)

  const body = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
    <A:calendar-color/>
  </D:prop>
</D:propfind>`

  const resp = await fetch(homeUrl, {
    method: 'PROPFIND',
    headers: {
      Authorization: authHeader(creds),
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: '1',
    },
    body,
    signal: AbortSignal.timeout(10000),
  })

  if (!resp.ok && resp.status !== 207) {
    throw new Error(`PROPFIND calendars failed: ${resp.status}`)
  }

  const xml = await resp.text()
  const calendars: CalDAVCalendar[] = []

  // Parse multistatus response â look for responses that have <calendar/> resourcetype
  const responses = xml.split(/<D:response>/i).slice(1)
  for (const r of responses) {
    // Must be a calendar resource
    if (!/<C:calendar\s*\/?>/i.test(r) && !/<calendar\s*\/?>/i.test(r)) continue

    const hrefMatch = r.match(/<D:href[^>]*>([^<]+)<\/D:href>/i)
    const nameMatch = r.match(/<D:displayname[^>]*>([^<]*)<\/D:displayname>/i)
    const colorMatch = r.match(/<A:calendar-color[^>]*>([^<]*)<\/A:calendar-color>/i)

    if (hrefMatch) {
      calendars.push({
        url: new URL(hrefMatch[1], CALDAV_BASE).href,
        displayName: nameMatch?.[1] || 'Untitled',
        color: colorMatch?.[1] || undefined,
      })
    }
  }

  return calendars
}

// ---- 4. Fetch events in a date range ----
export async function getEvents(
  creds: CalDAVCredentials,
  calendarUrl: string,
  start: Date,
  end: Date
): Promise<CalDAVEvent[]> {
  const startStr = toICalDate(start)
  const endStr = toICalDate(end)

  const body = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${startStr}" end="${endStr}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`

  const resp = await fetch(calendarUrl, {
    method: 'REPORT',
    headers: {
      Authorization: authHeader(creds),
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: '1',
    },
    body,
    signal: AbortSignal.timeout(15000),
  })

  if (!resp.ok && resp.status !== 207) {
    throw new Error(`REPORT events failed: ${resp.status}`)
  }

  const xml = await resp.text()
  const events: CalDAVEvent[] = []

  const responses = xml.split(/<D:response>/i).slice(1)
  for (const r of responses) {
    const hrefMatch = r.match(/<D:href[^>]*>([^<]+)<\/D:href>/i)
    // calendar-data contains the raw iCalendar text
    const dataMatch = r.match(/<C:calendar-data[^>]*>([\s\S]*?)<\/C:calendar-data>/i)

    if (hrefMatch && dataMatch) {
      const ical = decodeXmlEntities(dataMatch[1].trim())
      const parsed = parseVEvent(ical)
      if (parsed) {
        events.push({
          ...parsed,
          url: new URL(hrefMatch[1], CALDAV_BASE).href,
          raw: ical,
        })
      }
    }
  }

  return events.sort((a, b) => new Date(a.dtstart).getTime() - new Date(b.dtstart).getTime())
}

// ---- 5. Create an event on Apple Calendar ----
export async function createEvent(
  creds: CalDAVCredentials,
  calendarUrl: string,
  event: {
    summary: string
    start: Date
    end: Date
    description?: string
    location?: string
  }
): Promise<{ uid: string; url: string }> {
  const uid = crypto.randomUUID()
  const eventUrl = calendarUrl.replace(/\/$/, '') + `/${uid}.ics`

  const ical = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Harbor//Harbor//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toICalDate(new Date())}`,
    `DTSTART:${toICalDate(event.start)}`,
    `DTEND:${toICalDate(event.end)}`,
    `SUMMARY:${escapeICalText(event.summary)}`,
    event.description ? `DESCRIPTION:${escapeICalText(event.description)}` : '',
    event.location ? `LOCATION:${escapeICalText(event.location)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n')

  const resp = await fetch(eventUrl, {
    method: 'PUT',
    headers: {
      Authorization: authHeader(creds),
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-None-Match': '*',  // Create only, don't overwrite
    },
    body: ical,
    signal: AbortSignal.timeout(10000),
  })

  if (!resp.ok && resp.status !== 201 && resp.status !== 204) {
    throw new Error(`PUT event failed: ${resp.status} ${await resp.text()}`)
  }

  return { uid, url: eventUrl }
}

// ---- 6. Delete an event ----
export async function deleteEvent(
  creds: CalDAVCredentials,
  eventUrl: string
): Promise<void> {
  const resp = await fetch(eventUrl, {
    method: 'DELETE',
    headers: {
      Authorization: authHeader(creds),
    },
    signal: AbortSignal.timeout(10000),
  })

  if (!resp.ok && resp.status !== 204 && resp.status !== 404) {
    throw new Error(`DELETE event failed: ${resp.status}`)
  }
}

// ---- 7. Check availability (busy slots) in a date range ----
export async function getAvailability(
  creds: CalDAVCredentials,
  calendarUrl: string,
  start: Date,
  end: Date
): Promise<{ start: Date; end: Date; summary: string }[]> {
  const events = await getEvents(creds, calendarUrl, start, end)
  return events.map(e => ({
    start: new Date(e.dtstart),
    end: new Date(e.dtend),
    summary: e.summary,
  }))
}

// ---- Helper: discover and cache the default calendar URL ----
export async function getDefaultCalendarUrl(creds: CalDAVCredentials): Promise<string> {
  const calendars = await listCalendars(creds)
  if (calendars.length === 0) {
    throw new Error('No calendars found on this Apple account')
  }
  // Prefer the first non-system calendar, or just the first one
  return calendars[0].url
}

// ---- iCalendar helpers ----
function toICalDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function escapeICalText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function parseVEvent(ical: string): { uid: string; summary: string; dtstart: string; dtend: string; description?: string; location?: string } | null {
  const uidMatch = ical.match(/^UID:(.+)$/m)
  const summaryMatch = ical.match(/^SUMMARY:(.+)$/m)
  const dtstartMatch = ical.match(/^DTSTART[^:]*:(.+)$/m)
  const dtendMatch = ical.match(/^DTEND[^:]*:(.+)$/m)
  const descMatch = ical.match(/^DESCRIPTION:(.+)$/m)
  const locMatch = ical.match(/^LOCATION:(.+)$/m)

  if (!uidMatch || !dtstartMatch) return null

  return {
    uid: uidMatch[1].trim(),
    summary: summaryMatch?.[1]?.trim() || 'Untitled',
    dtstart: parseICalDate(dtstartMatch[1].trim()),
    dtend: dtendMatch ? parseICalDate(dtendMatch[1].trim()) : parseICalDate(dtstartMatch[1].trim()),
    description: descMatch?.[1]?.trim(),
    location: locMatch?.[1]?.trim(),
  }
}

function parseICalDate(icalDate: string): string {
  // Handle formats: 20260415T140000Z or 20260415T140000
  const match = icalDate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/)
  if (match) {
    const [, y, m, d, h, min, s] = match
    const suffix = icalDate.endsWith('Z') ? 'Z' : ''
    return `${y}-${m}-${d}T${h}:${min}:${s}${suffix}`
  }
  return icalDate
}
