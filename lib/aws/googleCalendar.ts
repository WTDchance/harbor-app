// lib/aws/googleCalendar.ts
//
// W51 D3 follow-up — AWS-native Google Calendar wrapper.
// Mirrors the shape of lib/outlookCalendar.ts: token exchange, refresh,
// account-email lookup, free/busy lookup, and event creation.
//
// Tokens persist KMS-encrypted in practice_calendar_integrations via
// lib/aws/token-encryption. Scopes:
//   - openid email profile
//   - https://www.googleapis.com/auth/calendar.events
//   - https://www.googleapis.com/auth/calendar.readonly
//
// Network calls use AbortSignal.timeout(8000) so a slow upstream cannot
// hang a Vapi assistant-request webhook past Twilio's silence timeout.

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const CAL_API = 'https://www.googleapis.com/calendar/v3'
const FETCH_TIMEOUT_MS = 8000

export interface GoogleTokenSet {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: 'Bearer'
  scope: string
  id_token?: string
}

function clientCreds(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID
  const secret = process.env.GOOGLE_CLIENT_SECRET
  if (!id || !secret) throw new Error('Google OAuth not configured')
  return { id, secret }
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<GoogleTokenSet> {
  const { id, secret } = clientCreds()
  const params = new URLSearchParams({
    client_id: id, client_secret: secret,
    code, redirect_uri: redirectUri, grant_type: 'authorization_code',
  })
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!r.ok) throw new Error(`google_token_exchange_failed: ${r.status}`)
  return r.json() as Promise<GoogleTokenSet>
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenSet> {
  const { id, secret } = clientCreds()
  const params = new URLSearchParams({
    client_id: id, client_secret: secret,
    refresh_token: refreshToken, grant_type: 'refresh_token',
  })
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!r.ok) throw new Error(`google_token_refresh_failed: ${r.status}`)
  // Google's refresh response omits refresh_token; the original is reused.
  const tok = await r.json() as GoogleTokenSet
  if (!tok.refresh_token) tok.refresh_token = refreshToken
  return tok
}

/**
 * Fetch userinfo to capture the account_email at connection time.
 * Returns null on any upstream failure — caller should default to
 * `'unknown@google'` to keep the integration row insertable.
 */
export async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const r = await fetch(USERINFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!r.ok) return null
    const j = await r.json() as { email?: string }
    return j.email || null
  } catch {
    return null
  }
}

export interface FreeBusyInterval {
  start: string
  end: string
}

/**
 * Returns busy intervals from the user's primary calendar, or `null` if
 * the upstream call failed. Callers MUST distinguish null (lookup failed —
 * cannot infer availability) from `[]` (truly free). The Outlook wrapper
 * returns `[]` on failure for legacy reasons; Google does not, because
 * the Reception free-busy endpoint specifically wants to fail closed.
 */
export async function getFreeBusy(
  accessToken: string,
  startISO: string,
  endISO: string,
): Promise<FreeBusyInterval[] | null> {
  try {
    const r = await fetch(`${CAL_API}/freeBusy`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        timeMin: startISO,
        timeMax: endISO,
        items: [{ id: 'primary' }],
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!r.ok) return null
    const j = await r.json() as { calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> }
    const cal = j.calendars?.primary
    if (!cal) return null
    if (cal.errors && cal.errors.length > 0) return null
    return (cal.busy ?? []).map(b => ({ start: b.start, end: b.end }))
  } catch {
    return null
  }
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

export async function createEvent(
  accessToken: string,
  args: CreateEventArgs,
): Promise<{ id: string; webLink?: string } | null> {
  try {
    const r = await fetch(`${CAL_API}/calendars/primary/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        summary: args.subject,
        description: args.bodyHtml,
        start: { dateTime: args.startISO, timeZone: args.timezone || 'UTC' },
        end:   { dateTime: args.endISO,   timeZone: args.timezone || 'UTC' },
        location: args.location,
        attendees: (args.attendees ?? []).map(a => ({ email: a })),
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!r.ok) return null
    const j = await r.json() as { id?: string; htmlLink?: string }
    if (!j.id) return null
    return { id: j.id, webLink: j.htmlLink }
  } catch {
    return null
  }
}
