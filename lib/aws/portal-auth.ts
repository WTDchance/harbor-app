// Patient portal session — Cognito + RDS port of lib/ehr/portal.ts.
//
// Design notes (signed off in the phase-4a portal investigation):
//
//   * Token == session. The patient row IS the session store: a long-random
//     token (`p_<24 base64url bytes>`) lives on patients.portal_access_token
//     with portal_token_expires_at as a TTL. Rotation = revocation, so the
//     therapist can boot a stalker / lost-device scenario instantly by
//     re-minting the token.
//
//   * Two transports, one identity. We accept either:
//       - Authorization: Bearer <token>   (native iOS/Android — Keychain)
//       - Cookie  harbor_portal_session=<token>   (web)
//     Whichever is found first wins. Token format is identical, so the
//     same value can move between transports if needed.
//
//   * No second Cognito user pool. Patients stay app-managed; one Cognito
//     pool serves therapists/admins only. This avoids per-patient pool
//     quotas, MFA flows, and dual-identity drift.
//
//   * sessionTokenHash on the returned session is sha256(token), suitable
//     for inclusion in audit_logs without leaking the bearer token itself.
//
//   * camelCase on the AWS surface (patientId, practiceId) — matches
//     requireApiSession()'s shape and the rest of lib/aws/*.

import { cookies, headers } from 'next/headers'
import { createHash, randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { pool } from './db'

export const PORTAL_COOKIE = 'harbor_portal_session'
const COOKIE_MAX_AGE = 60 * 60 * 8 // 8 hours of cookie liveness — token TTL is separate (30d on the row)

export type PortalSession = {
  patientId: string
  practiceId: string
  firstName: string
  lastName: string
  /** sha256(token), hex. Use this as the audit-log identifier — never the raw token. */
  sessionTokenHash: string
}

/** Mint a new portal access token. Format: 'p_' + 24 random bytes base64url. */
export function newPortalToken(): string {
  return 'p_' + randomBytes(24).toString('base64url')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Pull the bearer token from either the Authorization header or the
 * harbor_portal_session cookie. Header wins when both are present.
 */
async function readBearerToken(): Promise<string | null> {
  // Authorization: Bearer <token>
  try {
    const h = await headers()
    const authz = h.get('authorization') || h.get('Authorization')
    if (authz && authz.toLowerCase().startsWith('bearer ')) {
      const tok = authz.slice(7).trim()
      if (tok) return tok
    }
  } catch {
    // headers() can throw outside a request context — fall through.
  }
  // Cookie fallback (web).
  try {
    const c = await cookies()
    const tok = c.get(PORTAL_COOKIE)?.value
    if (tok) return tok
  } catch {
    // ditto
  }
  return null
}

/**
 * Look up the patient by token, validate TTL. Used by both
 * getPortalSession() (cookie/bearer path) and verifyAndConsumeLoginToken()
 * (the explicit /api/portal/login flow that sets the cookie).
 */
async function loadSessionByToken(token: string): Promise<PortalSession | null> {
  if (!token) return null
  try {
    const { rows } = await pool.query(
      `SELECT id, practice_id, first_name, last_name, portal_token_expires_at
         FROM patients
        WHERE portal_access_token = $1
        LIMIT 1`,
      [token],
    )
    const patient = rows[0]
    if (!patient) return null
    if (
      patient.portal_token_expires_at &&
      new Date(patient.portal_token_expires_at).getTime() < Date.now()
    ) {
      return null
    }
    return {
      patientId: patient.id,
      practiceId: patient.practice_id,
      firstName: patient.first_name ?? '',
      lastName: patient.last_name ?? '',
      sessionTokenHash: hashToken(token),
    }
  } catch {
    return null
  }
}

/** Permissive — returns null when the caller isn't a portal patient. */
export async function getPortalSession(): Promise<PortalSession | null> {
  const token = await readBearerToken()
  if (!token) return null
  return loadSessionByToken(token)
}

/**
 * Strict — for portal API routes. Returns 401 NextResponse when missing
 * or invalid; otherwise the typed PortalSession.
 *
 *   const sess = await requirePortalSession()
 *   if (sess instanceof NextResponse) return sess
 *   // sess.patientId, sess.practiceId, sess.sessionTokenHash, ...
 */
export async function requirePortalSession(): Promise<PortalSession | NextResponse> {
  const sess = await getPortalSession()
  if (!sess) {
    return NextResponse.json({ error: 'not_signed_in' }, { status: 401 })
  }
  return sess
}

/**
 * Login flow — verify the token, stamp portal_last_login_at, return the
 * session. Caller (POST /api/portal/login) is responsible for setting the
 * cookie via setPortalSessionCookie() AND returning the bare token in the
 * JSON body so native clients can stash it in Keychain/Keystore.
 */
export async function verifyAndConsumeLoginToken(
  token: string,
): Promise<PortalSession | null> {
  const sess = await loadSessionByToken(token)
  if (!sess) return null
  // Stamp last login. Errors here are non-fatal — login still succeeds.
  pool
    .query(
      `UPDATE patients SET portal_last_login_at = NOW() WHERE id = $1`,
      [sess.patientId],
    )
    .catch(err => console.error('[portal-auth] last_login stamp failed:', err.message))
  return sess
}

export async function setPortalSessionCookie(token: string): Promise<void> {
  const c = await cookies()
  c.set(PORTAL_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  })
}

export async function clearPortalSessionCookie(): Promise<void> {
  const c = await cookies()
  c.delete(PORTAL_COOKIE)
}
