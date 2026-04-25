// Harbor — Cognito session verification + OAuth token exchange.

import { CognitoJwtVerifier } from 'aws-jwt-verify'

const COGNITO_REGION = process.env.COGNITO_REGION || 'us-east-1'
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!
const COGNITO_APP_CLIENT_ID = process.env.COGNITO_APP_CLIENT_ID!
const COGNITO_DOMAIN = process.env.COGNITO_DOMAIN!
const COGNITO_REDIRECT_URI = process.env.COGNITO_REDIRECT_URI!

if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
  if (!COGNITO_USER_POOL_ID || !COGNITO_APP_CLIENT_ID) {
    console.warn('[cognito] COGNITO_USER_POOL_ID / COGNITO_APP_CLIENT_ID not set')
  }
}

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
  idToken: string
  accessToken: string
  expiresAt: string
}

export async function verifyIdToken(token: string) {
  return idVerifier().verify(token)
}

export async function verifyAccessToken(token: string) {
  return accessVerifier().verify(token)
}

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
  // Verbose trace — diagnoses invalid_grant. Logs do NOT include the code itself.
  console.log('[cognito] token exchange', JSON.stringify({
    tokenUrl,
    client_id: COGNITO_APP_CLIENT_ID,
    redirect_uri: COGNITO_REDIRECT_URI,
    code_len: code.length,
  }))
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const txt = await res.text()
    // Surface error_description so the chat caller knows what to fix.
    console.error('[cognito] token exchange failed', JSON.stringify({
      status: res.status,
      body: txt,
      sent_redirect_uri: COGNITO_REDIRECT_URI,
      sent_client_id: COGNITO_APP_CLIENT_ID,
    }))
    throw new Error(`Cognito token exchange failed: ${res.status} ${txt}`)
  }
  return res.json()
}

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

export function loginUrl(state?: string): string {
  const u = new URL(`https://${COGNITO_DOMAIN}.auth.${COGNITO_REGION}.amazoncognito.com/login`)
  u.searchParams.set('client_id', COGNITO_APP_CLIENT_ID)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', 'email openid profile')
  u.searchParams.set('redirect_uri', COGNITO_REDIRECT_URI)
  if (state) u.searchParams.set('state', state)
  return u.toString()
}

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
