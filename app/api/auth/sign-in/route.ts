// app/api/auth/sign-in/route.ts
//
// Wave 32 — Direct Cognito sign-in. Replaces the Hosted UI redirect
// flow with a USER_PASSWORD_AUTH InitiateAuth call from our own form
// at /login. Sets the same Cognito session cookies the Hosted UI
// callback flow does, then returns the destination URL.
//
// POST { email, password, next? } → { redirect } | { error }

import { NextRequest, NextResponse } from 'next/server'
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  AuthFlowType,
} from '@aws-sdk/client-cognito-identity-provider'
import { verifyIdToken, SESSION_COOKIE, ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/aws/cognito'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COGNITO_REGION = process.env.COGNITO_REGION || process.env.AWS_REGION || 'us-east-1'
const COGNITO_APP_CLIENT_ID = process.env.COGNITO_APP_CLIENT_ID || ''

export async function POST(req: NextRequest) {
  if (!COGNITO_APP_CLIENT_ID) {
    return NextResponse.json({ error: 'Cognito client not configured' }, { status: 500 })
  }

  let body: { email?: string; password?: string; next?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const email = (body.email || '').trim()
  const password = body.password || ''
  const next = (body.next || '').trim()
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
  }

  const client = new CognitoIdentityProviderClient({ region: COGNITO_REGION })
  let result
  try {
    result = await client.send(
      new InitiateAuthCommand({
        AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
        ClientId: COGNITO_APP_CLIENT_ID,
        AuthParameters: { USERNAME: email, PASSWORD: password },
      }),
    )
  } catch (err: any) {
    // Cognito returns a structured error; surface the name so the
    // frontend can map it to a friendly message.
    const code = err?.name || 'NotAuthorizedException'
    return NextResponse.json({ error: code }, { status: 401 })
  }

  const auth = result.AuthenticationResult
  if (!auth?.IdToken || !auth.AccessToken) {
    // Wave 38 TS3 — return MFA / new-password challenges to the client
    // with the Cognito Session token so it can RespondToAuthChallenge.
    if (result.ChallengeName === 'SOFTWARE_TOKEN_MFA' || result.ChallengeName === 'MFA_SETUP') {
      return NextResponse.json(
        {
          challenge: result.ChallengeName,
          session: result.Session,
          email,
          next,
        },
        { status: 200 },
      )
    }
    return NextResponse.json(
      { error: result.ChallengeName || 'AuthenticationFailed' },
      { status: 401 },
    )
  }

  // Verify the ID token to extract claims (and prove it's signed by our pool)
  const claims = await verifyIdToken(auth.IdToken)

  // Determine redirect: admin → /admin, non-admin → next || /dashboard
  const adminEmails = (process.env.ADMIN_EMAIL || 'chancewonser@gmail.com')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  const isAdmin = adminEmails.includes((claims?.email || email).toLowerCase())
  const explicitNext = next.startsWith('/') ? next : ''
  const redirect = explicitNext || (isAdmin ? '/admin' : '/dashboard')

  // Set session cookies — same shape as the OAuth callback flow uses
  const isProd = process.env.NODE_ENV === 'production'
  const cookieOpts = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
  }
  const accessExpiresIn = auth.ExpiresIn ?? 3600

  const res = NextResponse.json({ redirect })
  res.cookies.set(SESSION_COOKIE, auth.IdToken, {
    ...cookieOpts,
    maxAge: accessExpiresIn,
  })
  res.cookies.set(ACCESS_COOKIE, auth.AccessToken, {
    ...cookieOpts,
    maxAge: accessExpiresIn,
  })
  if (auth.RefreshToken) {
    res.cookies.set(REFRESH_COOKIE, auth.RefreshToken, {
      ...cookieOpts,
      maxAge: 30 * 24 * 60 * 60, // 30 days
    })
  }
  return res
}
