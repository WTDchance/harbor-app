// Microsoft Outlook OAuth start. Cognito session → resolve practiceId →
// build Microsoft consent screen URL.
//
// Allowlist required: this route's redirect URI
//   https://lab.harboroffice.ai/api/integrations/outlook/callback
// must be added to the Microsoft App Registration's Redirect URIs.

import { NextResponse, type NextRequest } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.redirect(new URL('/login', req.url))

  const clientId = process.env.MICROSOFT_CLIENT_ID
  const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
  const redirectUri = `${appUrl}/api/integrations/outlook/callback`

  if (!clientId) {
    return NextResponse.json(
      { error: 'Outlook Calendar not configured (set MICROSOFT_CLIENT_ID)' },
      { status: 500 },
    )
  }

  const scopes = ['openid', 'profile', 'email', 'Calendars.ReadWrite', 'offline_access']

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    response_mode: 'query',
    state: Buffer.from(JSON.stringify({ practiceId: ctx.practiceId })).toString('base64'),
  })

  return NextResponse.redirect(
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`,
  )
}
