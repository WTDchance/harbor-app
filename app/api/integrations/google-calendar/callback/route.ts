import { supabaseAdmin } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

interface GoogleUserInfo {
  email: string
  name: string
}

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get('code')
    const state = req.nextUrl.searchParams.get('state')
    const error = req.nextUrl.searchParams.get('error')

    if (error) {
      return NextResponse.redirect(
        new URL(`/dashboard/settings?error=${encodeURIComponent(error)}`, req.url)
      )
    }

    if (!code || !state) {
      return NextResponse.redirect(
        new URL('/dashboard/settings?error=missing_parameters', req.url)
      )
    }

    let stateData: { practiceId: string }
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'))
    } catch {
      return NextResponse.redirect(
        new URL('/dashboard/settings?error=invalid_state', req.url)
      )
    }

    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/google-calendar/callback`

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(
        new URL('/dashboard/settings?error=server_misconfigured', req.url)
      )
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json()
      console.error('[google-calendar/callback] Token exchange failed:', errorData)
      return NextResponse.redirect(
        new URL(
          `/dashboard/settings?error=${encodeURIComponent(errorData.error || 'token_exchange_failed')}`,
          req.url
        )
      )
    }

    const tokens: GoogleTokenResponse = await tokenResponse.json()

    // Get user info
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    })

    if (!userResponse.ok) {
      console.error('[google-calendar/callback] Failed to fetch user info')
      return NextResponse.redirect(
        new URL('/dashboard/settings?error=failed_to_fetch_user_info', req.url)
      )
    }

    const userInfo: GoogleUserInfo = await userResponse.json()

    // Save to calendar_connections
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const { error: upsertError } = await supabaseAdmin
      .from('calendar_connections')
      .upsert(
        {
          practice_id: stateData.practiceId,
          provider: 'google',
          label: `Google Calendar (${userInfo.email})`,
          access_token: tokens.access_token,
            
          refresh_token: tokens.refresh_token || null,
          token_expires_at: expiresAt,
          connected_email: userInfo.email,
          sync_enabled: true,
          updated_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        },
        { onConflict: 'practice_id,provider' }
      )

    if (upsertError) {
      console.error('[google-calendar/callback] Upsert error:', upsertError)
      return NextResponse.redirect(
        new URL('/dashboard/settings?error=database_error', req.url)
      )
    }

    return NextResponse.redirect(
      new URL('/dashboard/settings?success=google_calendar_connected', req.url)
    )
  } catch (err) {
    console.error('[google-calendar/callback GET]', err)
    return NextResponse.redirect(
      new URL('/dashboard/settings?error=internal_server_error', req.url)
    )
  }
                  }
