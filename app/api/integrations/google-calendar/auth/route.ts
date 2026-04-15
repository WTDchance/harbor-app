import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

async function getPracticeId(): Promise<string | null> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (s) => {
          try { s.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {}
        }
      }
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabaseAdmin.from('users').select('practice_id').eq('id', user.id).single()
  return data?.practice_id || null
}

export async function GET(req: NextRequest) {
  try {
    const practiceId = await getPracticeId()
    if (!practiceId) {
      return NextResponse.redirect(new URL('/login', req.url))
    }

    const clientId = process.env.GOOGLE_CLIENT_ID
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/google-calendar/callback`

    if (!clientId) {
      return NextResponse.json(
        { error: 'Google Calendar not configured' },
        { status: 500 }
      )
    }

    const scopes = [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events'
    ]

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: Buffer.from(JSON.stringify({ practiceId })).toString('base64')
    })

    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

    return NextResponse.redirect(googleAuthUrl)
  } catch (err) {
    console.error('[google-calendar/auth GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
