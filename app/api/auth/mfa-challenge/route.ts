// app/api/auth/mfa-challenge/route.ts
//
// Wave 38 TS3 — second leg of TOTP MFA login. Client posts the
// Cognito Session it got from /api/auth/sign-in plus the 6-digit code
// from the user's authenticator app. We RespondToAuthChallenge with
// SOFTWARE_TOKEN_MFA and, on success, set the same session cookies as
// the regular sign-in path.

import { NextRequest, NextResponse } from 'next/server'
import {
  CognitoIdentityProviderClient,
  RespondToAuthChallengeCommand,
  ChallengeNameType,
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

  const body = await req.json().catch(() => null) as any
  const session = body?.session
  const email = (body?.email || '').trim()
  const code = (body?.code || '').trim()
  const next = (body?.next || '').trim()
  if (!session || !email || !code) {
    return NextResponse.json({ error: 'session, email and code are required' }, { status: 400 })
  }

  const client = new CognitoIdentityProviderClient({ region: COGNITO_REGION })
  let result
  try {
    result = await client.send(new RespondToAuthChallengeCommand({
      ClientId: COGNITO_APP_CLIENT_ID,
      ChallengeName: ChallengeNameType.SOFTWARE_TOKEN_MFA,
      Session: session,
      ChallengeResponses: {
        USERNAME: email,
        SOFTWARE_TOKEN_MFA_CODE: code,
      },
    }))
  } catch (err: any) {
    return NextResponse.json({ error: err?.name || 'mfa_failed' }, { status: 401 })
  }

  const auth = result.AuthenticationResult
  if (!auth?.IdToken || !auth.AccessToken) {
    return NextResponse.json({ error: result.ChallengeName || 'mfa_failed' }, { status: 401 })
  }

  const claims = await verifyIdToken(auth.IdToken)
  const adminEmails = (process.env.ADMIN_EMAIL || 'chancewonser@gmail.com')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const isAdmin = adminEmails.includes((claims?.email || email).toLowerCase())
  const explicitNext = next.startsWith('/') ? next : ''
  const redirect = explicitNext || (isAdmin ? '/admin' : '/dashboard')

  const isProd = process.env.NODE_ENV === 'production'
  const cookieOpts = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
  }
  const expiresIn = auth.ExpiresIn ?? 3600
  const res = NextResponse.json({ redirect })
  res.cookies.set(SESSION_COOKIE, auth.IdToken, { ...cookieOpts, maxAge: expiresIn })
  res.cookies.set(ACCESS_COOKIE, auth.AccessToken, { ...cookieOpts, maxAge: expiresIn })
  if (auth.RefreshToken) {
    res.cookies.set(REFRESH_COOKIE, auth.RefreshToken, { ...cookieOpts, maxAge: 30 * 86400 })
  }
  return res
}
