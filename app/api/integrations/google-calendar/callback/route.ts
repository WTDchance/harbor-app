// Google Calendar OAuth callback. Verifies BAA attestation rode through in
// state, exchanges code for tokens, fetches user info, upserts into
// calendar_connections.
//
// REFRESH-TOKEN STORAGE: stored as plaintext in calendar_connections.refresh_token.
// The RDS volume is encrypted at rest via KMS; inline application-layer
// encryption is a follow-up. Match legacy behavior bug-for-bug here.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

interface GoogleUserInfo { email: string; name: string }

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

  let stateData: { practiceId: string; baaAttested?: boolean }
  try {
    stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'))
  } catch {
    return NextResponse.redirect(appUrl('/dashboard/settings?error=invalid_state'))
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = `${(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')}/api/integrations/google-calendar/callback`

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(appUrl('/dashboard/settings?error=server_misconfigured'))
  }

  // HIPAA gate: refuse to store an active connection without BAA attestation.
  if (!stateData.baaAttested) {
    console.warn('[google-calendar/callback] BAA not attested; refusing', { practiceId: stateData.practiceId })
    return NextResponse.redirect(appUrl('/dashboard/settings?error=baa_not_attested'))
  }

  // Exchange code for tokens.
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  })
  if (!tokenRes.ok) {
    const errData = await tokenRes.json().catch(() => ({}))
    console.error('[google-calendar/callback] Token exchange failed:', errData)
    return NextResponse.redirect(
      appUrl(`/dashboard/settings?error=${encodeURIComponent(errData.error || 'token_exchange_failed')}`),
    )
  }
  const tokens: GoogleTokenResponse = await tokenRes.json()

  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!userRes.ok) {
    console.error('[google-calendar/callback] Failed to fetch user info')
    return NextResponse.redirect(appUrl('/dashboard/settings?error=failed_to_fetch_user_info'))
  }
  const userInfo: GoogleUserInfo = await userRes.json()

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  const nowIso = new Date().toISOString()

  try {
    await pool.query(
      `INSERT INTO calendar_connections (
         practice_id, provider, label,
         access_token, refresh_token, token_expires_at,
         connected_email, sync_enabled,
         hipaa_baa_attested_at, hipaa_workspace_attested,
         created_at, updated_at
       ) VALUES (
         $1, 'google', $2,
         $3, $4, $5,
         $6, true,
         $7, true,
         NOW(), NOW()
       )
       ON CONFLICT (practice_id, provider) DO UPDATE SET
         label = EXCLUDED.label,
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         token_expires_at = EXCLUDED.token_expires_at,
         connected_email = EXCLUDED.connected_email,
         sync_enabled = true,
         hipaa_baa_attested_at = EXCLUDED.hipaa_baa_attested_at,
         hipaa_workspace_attested = true,
         updated_at = NOW()`,
      [
        stateData.practiceId, `Google Calendar (${userInfo.email})`,
        tokens.access_token, tokens.refresh_token ?? null, expiresAt,
        userInfo.email, nowIso,
      ],
    )
  } catch (err) {
    console.error('[google-calendar/callback] Upsert error:', (err as Error).message)
    return NextResponse.redirect(appUrl('/dashboard/settings?error=database_error'))
  }

  return NextResponse.redirect(appUrl('/dashboard/settings?success=google_calendar_connected'))
}
