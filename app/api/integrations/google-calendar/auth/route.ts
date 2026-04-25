import { supabaseAdmin } from '@/lib/supabase'
import { getEffectivePracticeId } from '@/lib/active-practice'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'

async function getPracticeId(): Promise<string | null> {
  // supabase client removed (Cognito auth)
  const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) return null
  // Honor the admin "act as" cookie so connecting Google Calendar while
  // viewing another practice's dashboard stores tokens on THAT practice,
  // not the admin's own.
  return await getEffectivePracticeId(supabaseAdmin, user)
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
      // Propagate the attestation into OAuth state so the callback can
      // enforce that sync is only enabled after Workspace-BAA attestation.
      state: Buffer.from(JSON.stringify({
        practiceId,
        baaAttested: req.nextUrl.searchParams.get('baa_attested') === '1',
      })).toString('base64')
    })

    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

    return NextResponse.redirect(googleAuthUrl)
  } catch (err) {
    console.error('[google-calendar/auth GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
