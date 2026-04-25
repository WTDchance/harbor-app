// Cognito OAuth callback. The Hosted UI redirects here with ?code=... after
// the user signs in. We exchange the code for tokens, validate them, set
// HttpOnly cookies, and bounce to /dashboard/aws (the path-B test surface).

import { NextResponse, type NextRequest } from 'next/server'
import {
  exchangeCodeForTokens,
  verifyIdToken,
  SESSION_COOKIE,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} from '@/lib/aws/cognito'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  const state = url.searchParams.get('state') || '/dashboard/aws'

  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, req.url))
  }
  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', req.url))
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    // Sanity-check: verify the ID token before trusting the cookies we're about to set.
    await verifyIdToken(tokens.id_token)

    const target = state.startsWith('/') ? state : '/dashboard/aws'
    const res = NextResponse.redirect(new URL(target, req.url))

    const cookieOpts = {
      httpOnly: true,
      secure: true,
      sameSite: 'lax' as const,
      path: '/',
      // Cognito access/id tokens default to 1h. Match the cookie lifetime.
      maxAge: tokens.expires_in,
    }
    res.cookies.set(SESSION_COOKIE, tokens.id_token, cookieOpts)
    res.cookies.set(ACCESS_COOKIE, tokens.access_token, cookieOpts)
    // Refresh token: only the auth refresh route needs it. Scope its path tightly.
    res.cookies.set(REFRESH_COOKIE, tokens.refresh_token, {
      ...cookieOpts,
      path: '/api/auth',
      maxAge: 60 * 60 * 24 * 30, // 30 days; Cognito default refresh validity
    })
    return res
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown'
    console.error('[auth/callback] failed:', msg)
    return NextResponse.redirect(new URL(`/login?error=callback_failed`, req.url))
  }
}
