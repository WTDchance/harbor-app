// lib/active-practice.ts
//
// Wave 21 (AWS port). Super-admin "Act as Practice" helper, rewritten on
// Cognito + RDS pool. Public function signatures preserved so existing
// callers (15+ files) don't churn — internally we ignore the legacy
// `supabase` and `user` parameters and read the Cognito session +
// users table directly.
//
// Returns the effective practice_id for the request:
//   - For admin (ADMIN_EMAIL match) with the harbor_act_as_practice
//     cookie set, returns the cookie's practice_id (after verifying it
//     exists in RDS).
//   - Otherwise returns the user's own practice_id from users.practice_id.
//   - Returns null if no Cognito session or no users row.

import { cookies } from 'next/headers'
import { pool } from '@/lib/aws/db'
import { getServerSession } from '@/lib/aws/session'

export const ACT_AS_COOKIE = 'harbor_act_as_practice'

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'chancewonser@gmail.com').toLowerCase()

/**
 * Compatibility shape — older callers pass a `User`-like object whose
 * `email` field we use to detect admin. New AWS callers don't need to pass
 * anything; the helper falls back to the Cognito session if `user` is
 * undefined.
 */
export type UserLike = { email?: string | null; id?: string | null } | null | undefined

function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase() === ADMIN_EMAIL
}

async function readActAsCookie(): Promise<string | null> {
  try {
    const c = await cookies()
    return c.get(ACT_AS_COOKIE)?.value ?? null
  } catch {
    return null
  }
}

async function verifyPracticeExists(practiceId: string): Promise<boolean> {
  try {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM practices WHERE id = $1 LIMIT 1`,
      [practiceId],
    )
    return (rowCount ?? 0) > 0
  } catch {
    return false
  }
}

async function lookupUserPracticeByCognitoSub(sub: string): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ practice_id: string | null }>(
      `SELECT practice_id FROM users WHERE cognito_sub = $1 LIMIT 1`,
      [sub],
    )
    return rows[0]?.practice_id ?? null
  } catch {
    return null
  }
}

/**
 * Resolve the effective practice_id for this request. The legacy
 * `supabase` param is ignored — kept in the signature so callers
 * compile without churn. The legacy `user` param is consulted only for
 * its email (admin detection); when omitted we fall back to the
 * Cognito session.
 */
export async function getEffectivePracticeId(
  _supabaseUnused: unknown,
  user?: UserLike,
): Promise<string | null> {
  let email = user?.email ?? null
  let cognitoSub: string | null = null

  // Always read the Cognito session — the AWS source of truth.
  const session = await getServerSession()
  if (session) {
    if (!email) email = session.email
    cognitoSub = session.sub
  }

  // No session and the legacy caller didn't pass a usable user — bail.
  if (!cognitoSub && !user) return null

  // Admin override via act-as cookie.
  if (isAdminEmail(email)) {
    const override = await readActAsCookie()
    if (override && (await verifyPracticeExists(override))) {
      return override
    }
  }

  if (!cognitoSub) return null
  return await lookupUserPracticeByCognitoSub(cognitoSub)
}

/**
 * Returns { practiceId, isImpersonating } — isImpersonating is true
 * when the admin has an act-as cookie set to a practice that is NOT
 * their own.
 */
export async function getActivePracticeContext(
  _supabaseUnused: unknown,
  user?: UserLike,
): Promise<{ practiceId: string | null; isImpersonating: boolean }> {
  const practiceId = await getEffectivePracticeId(_supabaseUnused, user)
  if (!practiceId) return { practiceId, isImpersonating: false }

  const session = await getServerSession()
  const email = user?.email ?? session?.email ?? null
  if (!isAdminEmail(email)) return { practiceId, isImpersonating: false }

  const override = await readActAsCookie()
  return {
    practiceId,
    isImpersonating: !!override && override === practiceId,
  }
}

export function isAdminUser(user: UserLike): boolean {
  return isAdminEmail(user?.email ?? null)
}

/**
 * Compat alias kept for legacy callers. Same behavior as
 * getEffectivePracticeId.
 */
export async function resolvePracticeIdForApi(
  _supabaseUnused: unknown,
  user?: UserLike,
): Promise<string | null> {
  return getEffectivePracticeId(_supabaseUnused, user)
}
