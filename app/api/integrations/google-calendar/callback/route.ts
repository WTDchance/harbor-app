import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// GET /api/integrations/google-calendar/callback
// Google redirects here after the user grants consent.
// Exchanges the authorization code for access + refresh tokens,
// saves them to the practice record, then redirects back to Settings.

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const errorParam = searchParams.get('error')

  const settingsUrl = new URL(
    '/dashboard/settings',
    process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
  )

  // User denied access
  if (errorParam === 'access_denied') {
    settingsUrl.searchParams.set('gcal', 'denied')
    return NextResponse.redirect(settingsUrl)
  }

  if (!code || !state) {
    settingsUrl.searchParams.set('gcal', 'error')
    return NextResponse.redirect(settingsUrl)
  }

  try {
    // Verify state cookie matches URL state to prevent CSRF
    const cookieState = req.cookies.get('gcal_state')?.value
    if (!cookieState || cookieState !== state) {
      console.error('Google Calendar callback: state mismatch')
      settingsUrl.searchParams.set('gcal', 'error')
      return NextResponse.redirect(settingsUrl)
    }

    // Decode practice ID from state
    const practiceId = Buffer.from(state, 'base64url').toString('utf8')

    // Exchange authorization code for tokens
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
    const redirectUri = `${appUrl}/api/integrations/google-calendar/callback`

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      console.error('Token exchange failed:', err)
      settingsUrl.searchParams.set('gcal', 'error')
      return NextResponse.redirect(settingsUrl)
    }

    const tokens = await tokenRes.json()

    // Fetch the user's email from Google
    const infoRes = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    )
    const userInfo = infoRes.ok ? await infoRes.json() : {}
    const calendarEmail = userInfo.email || null

    // Save tokens + email to the practice record
    const tokenPayload = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      token_type: tokens.token_type || 'Bearer',
    }

    const { error: dbError } = await supabaseAdmin
      .from('practices')
      .update({
        google_calendar_token: tokenPayload,
        google_calendar_email: calendarEmail,
      })
      .eq('id', practiceId)

    if (dbError) {
      console.error('Failed to save Google Calendar token:', dbError)
      settingsUrl.searchParams.set('gcal', 'error')
      const res = NextResponse.redirect(settingsUrl)
      res.cookies.delete('gcal_state')
      return res
    }

    settingsUrl.searchParams.set('gcal', 'connected')
    const res = NextResponse.redirect(settingsUrl)
    res.cookies.delete('gcal_state')
    return res
  } catch (error: any) {
    console.error('Google Calendar callback error:', error)
    settingsUrl.searchParams.set('gcal', 'error')
    const res = NextResponse.redirect(settingsUrl)
    res.cookies.delete('gcal_state')
    return res
  }
}
