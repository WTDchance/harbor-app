import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/integrations/google-calendar/auth
// Generates the Google OAuth consent URL and redirects the user.
// After consent, Google sends the user to /callback with a ?code=.

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (s) => {
            try { s.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {}
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.redirect(new URL('/login', req.url))
    }

    // Find the practice for this user
    const { data: practice } = await supabase
      .from('practices')
      .select('id')
      .eq('notification_email', user.email)
      .single()

    if (!practice) {
      return NextResponse.redirect(
        new URL('/dashboard/settings?error=no_practice', req.url)
      )
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      return NextResponse.redirect(
        new URL('/dashboard/settings?error=gcal_not_configured', req.url)
      )
    }

    // Encode practice ID in the state param so we can retrieve it in the callback.
    // We also store it in a short-lived cookie to verify it wasn't tampered with.
    const state = Buffer.from(practice.id).toString('base64url')

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'
    const redirectUri = `${appUrl}/api/integrations/google-calendar/callback`

    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/userinfo.email',
      ].join(' '),
      access_type: 'offline',
      prompt: 'consent',   // force consent so we always get a refresh_token
      state,
    })

    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`

    // Store state in cookie so callback can verify it
    const res = NextResponse.redirect(oauthUrl)
    res.cookies.set('gcal_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
      path: '/',
    })

    return res
  } catch (error: any) {
    console.error('Google Calendar auth error:', error)
    return NextResponse.redirect(
      new URL('/dashboard/settings?error=gcal_auth_failed', req.url)
    )
  }
}
