import { NextResponse, type NextRequest } from 'next/server'
import {
  exchangeCodeForTokens,
  verifyIdToken,
  SESSION_COOKIE,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} from '@/lib/aws/cognito'
import { absoluteUrl, publicOrigin } from '@/lib/aws/url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  const state = url.searchParams.get('state') || '/dashboard'
  console.log('[auth/callback] enter', JSON.stringify({
    has_code: !!code,
    error,
    state,
    origin: publicOrigin(req),
    host: req.headers.get('host'),
    xfHost: req.headers.get('x-forwarded-host'),
    xfProto: req.headers.get('x-forwarded-proto'),
  }))

  if (error) {
    return NextResponse.redirect(absoluteUrl(req, `/login?error=${encodeURIComponent(error)}`))
  }
  if (!code) {
    return NextResponse.redirect(absoluteUrl(req, '/login?error=missing_code'))
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    console.log('[auth/callback] tokens received', JSON.stringify({
      id_len: tokens.id_token?.length, access_len: tokens.access_token?.length,
      refresh_len: tokens.refresh_token?.length, expires_in: tokens.expires_in,
    }))
    const claims = await verifyIdToken(tokens.id_token)
    console.log('[auth/callback] id token verified')

    // Wave 30 — admin landing routing. Admins (per ADMIN_EMAIL allowlist)
    // land on /admin by default; everyone else lands on /dashboard. An
    // explicit ?next= override (e.g. deep link from email) wins either
    // way. The default-to-dashboard fallback is preserved when state is
    // exactly '/dashboard'.
    const adminEmails = (process.env.ADMIN_EMAIL || 'chancewonser@gmail.com')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
    const isAdmin = !!claims?.email && adminEmails.includes(claims.email.toLowerCase())
    const stateIsDefault = state === '/dashboard'
    const defaultTarget = isAdmin ? '/admin' : '/dashboard'
    const target = state.startsWith('/')
      ? (stateIsDefault ? defaultTarget : state)
      : defaultTarget
    const redirectTo = absoluteUrl(req, target)
    console.log('[auth/callback] redirecting to', redirectTo)
    const res = NextResponse.redirect(redirectTo)

    const cookieOpts = {
      httpOnly: true,
      secure: true,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: tokens.expires_in,
    }
    res.cookies.set(SESSION_COOKIE, tokens.id_token, cookieOpts)
    res.cookies.set(ACCESS_COOKIE, tokens.access_token, cookieOpts)
    res.cookies.set(REFRESH_COOKIE, tokens.refresh_token, {
      ...cookieOpts,
      path: '/api/auth',
      maxAge: 60 * 60 * 24 * 30,
    })
    console.log('[auth/callback] cookies set, returning 307')
    return res
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown'
    console.error('[auth/callback] failed:', msg)
    return NextResponse.redirect(absoluteUrl(req, '/login?error=callback_failed'))
  }
}
