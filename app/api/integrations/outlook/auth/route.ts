// app/api/integrations/outlook/auth/route.ts
//
// W51 D3 — Outlook (Microsoft Graph) OAuth start. Redirects to Microsoft
// consent screen with the practice id encoded in `state`.

import { NextResponse, type NextRequest } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SCOPES = [
  'openid', 'email', 'profile', 'offline_access',
  'https://graph.microsoft.com/Calendars.ReadWrite',
].join(' ')

export async function GET(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.redirect(new URL('/login', req.url))

  const clientId = process.env.OUTLOOK_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID
  const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
  const redirectUri = `${appUrl}/api/integrations/outlook/callback`
  if (!clientId) return NextResponse.json({ error: 'Outlook OAuth not configured (set OUTLOOK_CLIENT_ID or MICROSOFT_CLIENT_ID)' }, { status: 500 })

  const state = Buffer.from(JSON.stringify({
    practiceId: ctx.practiceId,
    therapistId: req.nextUrl.searchParams.get('therapist_id') ?? null,
  })).toString('base64url')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: SCOPES,
    state,
    prompt: 'select_account',
  })

  return NextResponse.redirect(
    new URL(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`),
  )
}
