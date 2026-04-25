// Logout: clear cookies + redirect to Cognito's /logout endpoint, which
// terminates the Hosted UI session and bounces back to /login.

import { NextResponse, type NextRequest } from 'next/server'
import { logoutUrl, SESSION_COOKIE, ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/aws/cognito'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const res = NextResponse.redirect(logoutUrl())
  // Expire all session cookies immediately.
  for (const name of [SESSION_COOKIE, ACCESS_COOKIE]) {
    res.cookies.set(name, '', { path: '/', maxAge: 0, httpOnly: true, secure: true, sameSite: 'lax' })
  }
  res.cookies.set(REFRESH_COOKIE, '', { path: '/api/auth', maxAge: 0, httpOnly: true, secure: true, sameSite: 'lax' })
  return res
}
