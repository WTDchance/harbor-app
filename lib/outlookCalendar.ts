// lib/outlookCalendar.ts
//
// W51 D3 — minimal Microsoft Graph wrapper for the reception-only calendar
// integration. Mirrors lib/googleCalendar.ts in shape: token refresh,
// free/busy lookup, and event creation.
//
// Uses the application's tenant-aware OAuth (Microsoft Identity Platform v2),
// /me/calendar/* endpoints. Scopes:
//   - openid email profile offline_access
//   - https://graph.microsoft.com/Calendars.ReadWrite
//
// Tokens persisted KMS-encrypted in practice_calendar_integrations.

const GRAPH = 'https://graph.microsoft.com/v1.0'
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

export interface OutlookTokenSet {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: 'Bearer'
  scope: string
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<OutlookTokenSet> {
  const clientId = process.env.OUTLOOK_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Outlook OAuth not configured')
  const params = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    code, redirect_uri: redirectUri, grant_type: 'authorization_code',
  })
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!r.ok) throw new Error(`outlook_token_exchange_failed: ${r.status}`)
  return r.json() as Promise<OutlookTokenSet>
}

export async function refreshAccessToken(refreshToken: string): Promise<OutlookTokenSet> {
  const clientId = process.env.OUTLOOK_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Outlook OAuth not configured')
  const params = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    refresh_token: refreshToken, grant_type: 'refresh_token',
  })
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!r.ok) throw new Error(`outlook_token_refresh_failed: ${r.status}`)
  return r.json() as Promise<OutlookTokenSet>
}

/**
 * Fetch userinfo to capture the account_email at connection time.
 */
export async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  const r = await fetch(`${GRAPH}/me?$select=mail,userPrincipalName`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!r.ok) return null
  const j = await r.json() as any
  return j.mail || j.userPrincipalName || null
}

export interface FreeBusyInterval {
  start: string
  end: string
}

export async function getFreeBusy(accessToken: string, startISO: string, endISO: string): Promise<FreeBusyInterval[]> {
  const r = await fetch(`${GRAPH}/me/calendar/getSchedule`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      schedules: [(await fetchAccountEmail(accessToken)) || 'me'],
      startTime: { dateTime: startISO, timeZone: 'UTC' },
      endTime:   { dateTime: endISO,   timeZone: 'UTC' },
      availabilityViewInterval: 30,
    }),
  })
  if (!r.ok) return []
  const j = await r.json() as any
  const out: FreeBusyInterval[] = []
  for (const sched of j.value ?? []) {
    for (const item of sched.scheduleItems ?? []) {
      out.push({
        start: item.start?.dateTime,
        end:   item.end?.dateTime,
      })
    }
  }
  return out
}

export interface CreateEventArgs {
  subject: string
  bodyHtml?: string
  startISO: string
  endISO: string
  timezone?: string
  attendees?: string[]
  location?: string
}

export async function createEvent(accessToken: string, args: CreateEventArgs): Promise<{ id: string; webLink?: string } | null> {
  const r = await fetch(`${GRAPH}/me/calendar/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      subject: args.subject,
      body: args.bodyHtml ? { contentType: 'HTML', content: args.bodyHtml } : undefined,
      start: { dateTime: args.startISO, timeZone: args.timezone || 'UTC' },
      end:   { dateTime: args.endISO,   timeZone: args.timezone || 'UTC' },
      location: args.location ? { displayName: args.location } : undefined,
      attendees: (args.attendees ?? []).map(a => ({ emailAddress: { address: a }, type: 'required' })),
    }),
  })
  if (!r.ok) return null
  const j = await r.json() as any
  return { id: j.id, webLink: j.webLink }
}
