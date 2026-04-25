// Harbor — server-side session lookup helpers.
//
// Reads HttpOnly cookies set by /api/auth/callback, verifies the ID token
// against Cognito's JWKS, returns a typed CognitoSession or null.
//
// Use from server components, route handlers, and middleware-after-validation
// flows. Caches verification per-request via React's cache().

import { cookies } from 'next/headers'
import { cache } from 'react'
import { verifyIdToken, SESSION_COOKIE, ACCESS_COOKIE, type CognitoSession } from './cognito'

/**
 * Returns the current Cognito session or null if absent / invalid.
 * Cached per-request so multiple server components don't re-verify.
 */
export const getServerSession = cache(async (): Promise<CognitoSession | null> => {
  try {
    const c = await cookies()
    const idToken = c.get(SESSION_COOKIE)?.value
    const accessToken = c.get(ACCESS_COOKIE)?.value
    if (!idToken || !accessToken) return null

    const payload = await verifyIdToken(idToken)
    const exp = typeof payload.exp === 'number' ? payload.exp : 0
    return {
      sub: String(payload.sub),
      email: String(payload.email || ''),
      emailVerified: Boolean(payload.email_verified),
      idToken,
      accessToken,
      expiresAt: new Date(exp * 1000).toISOString(),
    }
  } catch (err) {
    // Invalid / expired token — caller treats as logged out.
    return null
  }
})

/**
 * Throwing variant — for routes that should 401 on missing session.
 */
export async function requireSession(): Promise<CognitoSession> {
  const s = await getServerSession()
  if (!s) {
    throw new Response('Unauthorized', { status: 401 })
  }
  return s
}
