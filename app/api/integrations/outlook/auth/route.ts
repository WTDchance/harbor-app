import { supabaseAdmin } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import { resolvePracticeIdForApi } from '@/lib/active-practice'
import { requireApiSession } from '@/lib/aws/api-auth'

async function getPracticeId(): Promise<string | null> {
  // supabase client removed (Cognito auth)
  const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) return null
  return resolvePracticeIdForApi(supabaseAdmin, user)
}

export async function GET(req: NextRequest) {
  try {
    const practiceId = await getPracticeId()
    if (!practiceId) {
      return NextResponse.redirect(new URL('/login', req.url))
    }

    const clientId = process.env.MICROSOFT_CLIENT_ID
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/outlook/callback`

    if (!clientId) {
      return NextResponse.json(
        { error: 'Outlook Calendar not configured' },
        { status: 500 }
      )
    }

    const scopes = [
      'openid',
      'profile',
      'email',
      'Calendars.ReadWrite',
      'offline_access'
    ]

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      response_mode: 'query',
      state: Buffer.from(JSON.stringify({ practiceId })).toString('base64')
    })

    const microsoftAuthUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`

    return NextResponse.redirect(microsoftAuthUrl)
  } catch (err) {
    console.error('[outlook/auth GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
