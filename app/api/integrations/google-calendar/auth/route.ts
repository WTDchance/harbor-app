import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

const SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ].join(' ')

export async function GET(req: NextRequest) {
    try {
          const cookieStore = await cookies()
          const supabase = createServerClient(
                  process.env.NEXT_PUBLIC_SUPABASE_URL!,
                  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                      cookies: {
                                  getAll: () => cookieStore.getAll(),
                                  setAll: (s) => { try { s.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} }
                      }
            }
                )
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) return NextResponse.redirect(new URL('/login', req.url))

      const clientId = process.env.GOOGLE_CLIENT_ID
          if (!clientId) {
                  return NextResponse.redirect(
                            new URL('/dashboard/settings?error=google_not_configured', req.url)
                          )
          }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get('host')}`
          const redirectUri = `${appUrl}/api/integrations/google-calendar/callback`

      const state = Buffer.from(JSON.stringify({ email: user.email, ts: Date.now() })).toString('base64')

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
          authUrl.searchParams.set('client_id', clientId)
          authUrl.searchParams.set('redirect_uri', redirectUri)
          authUrl.searchParams.set('response_type', 'code')
          authUrl.searchParams.set('scope', SCOPES)
          authUrl.searchParams.set('access_type', 'offline')
          authUrl.searchParams.set('prompt', 'consent')
          authUrl.searchParams.set('state', state)

      return NextResponse.redirect(authUrl.toString())
    } catch (error: any) {
          return NextResponse.redirect(new URL('/dashboard/settings?error=oauth_error', req.url))
    }
}
