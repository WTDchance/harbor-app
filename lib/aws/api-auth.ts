// Cognito-backed API route auth helpers.
//
// Replaces the Supabase pattern:
//
//   const supabase = createServerClient(...)
//   const { data: { user } } = await supabase.auth.getUser()
//   if (!user) return 401
//   const practiceId = await resolvePracticeIdForApi(supabaseAdmin, user)
//
// With:
//
//   const ctx = await requireApiSession()
//   if (ctx instanceof NextResponse) return ctx  // 401 already returned
//   const { user, practice, practiceId, session } = ctx

import { NextResponse } from 'next/server'
import { getServerSession, type CognitoSession } from './session'
import { getUserAndPractice, type DbUserRow, type DbPracticeRow } from './db'

export type ApiAuthContext = {
  session: CognitoSession
  user: DbUserRow
  practice: DbPracticeRow | null
  practiceId: string | null
}

/**
 * For API routes that require authentication. Returns 401 if missing or invalid.
 * Returns 403 if the user has no users row in RDS.
 */
export async function requireApiSession(): Promise<ApiAuthContext | NextResponse> {
  const session = await getServerSession()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const row = await getUserAndPractice(session.sub).catch(() => null)
  if (!row?.user) {
    return NextResponse.json({ error: 'no_user_record' }, { status: 403 })
  }
  return {
    session,
    user: row.user,
    practice: row.practice,
    practiceId: row.user.practice_id,
  }
}

/**
 * Permissive variant — returns null if not signed in (caller decides).
 */
export async function getApiSession(): Promise<ApiAuthContext | null> {
  const session = await getServerSession()
  if (!session) return null
  const row = await getUserAndPractice(session.sub).catch(() => null)
  if (!row?.user) return null
  return {
    session,
    user: row.user,
    practice: row.practice,
    practiceId: row.user.practice_id,
  }
}

/**
 * Admin-only routes. Currently uses the email allowlist via ADMIN_EMAIL env.
 */
export async function requireAdminSession(): Promise<ApiAuthContext | NextResponse> {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const adminEmails = (process.env.ADMIN_EMAIL || 'chancewonser@gmail.com')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  if (!adminEmails.includes(ctx.session.email.toLowerCase())) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return ctx
}
