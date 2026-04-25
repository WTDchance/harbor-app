// Harbor — Cognito session verification + OAuth token exchange.
//
// The path-B replacement for @supabase/ssr. Validates ID + access tokens against
// Cognito's JWKS, exchanges authorization codes for tokens at /oauth2/token,
// and exposes a typed session object for server components and API routes.

import { CognitoJwtVerifier } from 'aws-jwt-verify'

const COGNITO_REGION = process.env.COGNITO_REGION || 'us-east-1'
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!
const COGNITO_APP_CLIENT_ID = process.env.COGNITO_APP_CLIENT_ID!
const COGNITO_DOMAIN = process.env.COGNITO_DOMAIN! // e.g. harbor-staging-auth
const COGNITO_REDIRECT_URI = process.env.COGNITO_REDIRECT_URI! // https://lab.harboroffice.ai/api/auth/callback

if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
  if (!COGNITO_USER_POOL_ID || !COGNITO_APP_CLIENT_ID) {
    // Don't throw here — the build runs with these missing. Validate at request time.
    console.warn('[cognito] COGNITO_USER_POOL_ID / COGNITO_APP_CLIENT_ID not set')
  }
}

// Verifier instances are reusable + cache JWKS. Allocated lazily so missing-env
// at build time doesn't crash the bundle.
let _idVerifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null
let _accessVerifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null

function idVerifier() {
  if (!_idVerifier) {
    _idVerifier = CognitoJwtVerifier.create({
      userPoolId: COGNITO_USER_POOL_ID,
      tokenUse: 'id',
      clientId: COGNITO_APP_CLIENT_ID,
    })
  }
  return _idVerifier
}

function accessVerifier() {
  if (!_accessVerifier) {
    _accessVerifier = CognitoJwtVerifier.create({
      userPoolId: COGNITO_USER_POOL_ID,
      tokenUse: 'access',
      clientId: COGNITO_APP_CLIENT_ID,
    })
  }
  return _accessVerifier
}

export type CognitoSession = {
  sub: string
  email: string
  emailVerified: boolean
  // Raw tokens — kept for downstream API calls. NEVER expose these to the client
  // beyond their HttpOnly cookies.
  idToken: string
  accessToken: string
  // ISO timestamp of token expiry — caller can decide to refresh.
  expiresAt: string
}

/**
 * Verify an ID token. Throws if invalid. Returns the validated payload.
 */
export async function verifyIdToken(token: string) {
  return idVerifier().verify(token)
}

/**
 * Verify an access token. Throws if invalid.
 */
export async function verifyAccessToken(token: string) {
  return accessVerifier().verify(token)
}

/**
 * Exchange a Cognito authorization code for tokens.
 * Called by /api/auth/callback after the Hosted UI redirects back.
 */
export async function exchangeCodeForTokens(code: string): Promise<{
  id_token: string
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}> {
  const tokenUrl = `https://${COGNITO_DOMAIN}.auth.${COGNITO_REGION}.amazoncognito.com/oauth2/token`
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: COGNITO_APP_CLIENT_ID,
    code,
    redirect_uri: COGNITO_REDIRECT_URI,
  })
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Cognito token exchange failed: ${res.status} ${txt}`)
  }
  return res.json()
}

/**
 * Refresh an access + ID token using a refresh token.
 */
export async function refreshTokens(refreshToken: string): Promise<{
  id_token: string
  access_token: string
  expires_in: number
  token_type: string
}> {
  const tokenUrl = `https://${COGNITO_DOMAIN}.auth.${COGNITO_REGION}.amazoncognito.com/oauth2/token`
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: COGNITO_APP_CLIENT_ID,
    refresh_token: refreshToken,
  })
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Cognito token refresh failed: ${res.status} ${txt}`)
  }
  return res.json()
}

/**
 * Build the Cognito Hosted UI login URL.
 */
export function loginUrl(state?: string): string {
  const u = new URL(`https://${COGNITO_DOMAIN}.auth.${COGNITO_REGION}.amazoncognito.com/login`)
  u.searchParams.set('client_id', COGNITO_APP_CLIENT_ID)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', 'email openid profile')
  u.searchParams.set('redirect_uri', COGNITO_REDIRECT_URI)
  if (state) u.searchParams.set('state', state)
  return u.toString()
}

/**
 * Build the Cognito Hosted UI logout URL. Sends user back to /login after.
 */
export function logoutUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://lab.harboroffice.ai'
  const u = new URL(`https://${COGNITO_DOMAIN}.auth.${COGNITO_REGION}.amazoncognito.com/logout`)
  u.searchParams.set('client_id', COGNITO_APP_CLIENT_ID)
  u.searchParams.set('logout_uri', `${appUrl}/login`)
  return u.toString()
}

export const SESSION_COOKIE = 'harbor_id'
export const ACCESS_COOKIE = 'harbor_access'
export const REFRESH_COOKIE = 'harbor_refresh'
