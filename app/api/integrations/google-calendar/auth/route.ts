// Google Calendar OAuth start. Cognito session → resolve practiceId →
// build Google consent-screen URL with state-encoded {practiceId, baaAttested}.
//
// HIPAA gate: practice must have attested to a Workspace + signed BAA at
// the modal step. The flag rides in OAuth state so the callback can refuse
// to store a connection without it.
//
// Allowlist required: this route's redirect URI
//   https://lab.harboroffice.ai/api/integrations/google-calendar/callback
// must be added to the Google Cloud Console OAuth client's Authorized
// redirect URIs before the consent screen will accept it.

import { NextResponse, type NextRequest } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.redirect(new URL('/login', req.url))

  const clientId = process.env.GOOGLE_CLIENT_ID
  const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
  const redirectUri = `${appUrl}/api/integrations/google-calendar/callback`

  if (!clientId) {
    return NextResponse.json(
      { error: 'Google Calendar not configured (set GOOGLE_CLIENT_ID)' },
      { status: 500 },
    )
  }

  const scopes = [
    'openid', 'email', 'profile',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ]

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: Buffer.from(JSON.stringify({
      practiceId: ctx.practiceId,
      baaAttested: req.nextUrl.searchParams.get('baa_attested') === '1',
    })).toString('base64'),
  })

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  )
}
