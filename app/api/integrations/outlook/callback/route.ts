// Microsoft Outlook OAuth callback. Exchange code for tokens, fetch user
// info from Microsoft Graph, upsert into calendar_connections.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface MicrosoftTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}
interface MicrosoftUserInfo {
  userPrincipalName: string
  displayName: string
  mail?: string
}

function appUrl(path: string): string {
  const base = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://lab.harboroffice.ai').replace(/\/$/, '')
  return `${base}${path}`
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const oauthError = req.nextUrl.searchParams.get('error')

  if (oauthError) {
    return NextResponse.redirect(appUrl(`/dashboard/settings?error=${encodeURIComponent(oauthError)}`))
  }
  if (!code || !state) {
    return NextResponse.redirect(appUrl('/dashboard/settings?error=missing_parameters'))
  }

  let stateData: { practiceId: string }
  try {
    stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'))
  } catch {
    return NextResponse.redirect(appUrl('/dashboard/settings?error=invalid_state'))
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  const redirectUri = `${(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')}/api/integrations/outlook/callback`

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(appUrl('/dashboard/settings?error=server_misconfigured'))
  }

  const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
      scope: 'openid profile email Calendars.ReadWrite offline_access',
    }),
  })
  if (!tokenRes.ok) {
    const errData = await tokenRes.json().catch(() => ({}))
    console.error('[outlook/callback] Token exchange failed:', errData)
    return NextResponse.redirect(
      appUrl(`/dashboard/settings?error=${encodeURIComponent(errData.error || 'token_exchange_failed')}`),
    )
  }
  const tokens: MicrosoftTokenResponse = await tokenRes.json()

  const userRes = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!userRes.ok) {
    console.error('[outlook/callback] Failed to fetch user info')
    return NextResponse.redirect(appUrl('/dashboard/settings?error=failed_to_fetch_user_info'))
  }
  const userInfo: MicrosoftUserInfo = await userRes.json()
  const email = userInfo.mail || userInfo.userPrincipalName

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  try {
    await pool.query(
      `INSERT INTO calendar_connections (
         practice_id, provider, label,
         access_token, refresh_token, token_expires_at,
         connected_email, sync_enabled,
         created_at, updated_at
       ) VALUES (
         $1, 'outlook', $2,
         $3, $4, $5,
         $6, true,
         NOW(), NOW()
       )
       ON CONFLICT (practice_id, provider) DO UPDATE SET
         label = EXCLUDED.label,
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         token_expires_at = EXCLUDED.token_expires_at,
         connected_email = EXCLUDED.connected_email,
         sync_enabled = true,
         updated_at = NOW()`,
      [stateData.practiceId, `Outlook Calendar (${email})`,
       tokens.access_token, tokens.refresh_token ?? null, expiresAt, email],
    )
  } catch (err) {
    console.error('[outlook/callback] Upsert error:', (err as Error).message)
    return NextResponse.redirect(appUrl('/dashboard/settings?error=database_error'))
  }

  return NextResponse.redirect(appUrl('/dashboard/settings?success=outlook_connected'))
}
