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


/**
 * EHR routes only — same as requireApiSession but additionally rejects with
 * 403 if the caller's practice does not have ehr_enabled = true. The /ehr/*
 * pages are gated client-side as well; this is the server-side enforcement.
 */
export async function requireEhrApiSession(): Promise<ApiAuthContext | NextResponse> {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practice || ctx.practice.ehr_enabled !== true) {
    return NextResponse.json({ error: 'ehr_not_enabled' }, { status: 403 })
  }
  // W48 T6 — reception_only practices must not access EHR endpoints
  // even if ehr_enabled is set somewhere upstream. ehr_full / ehr_only
  // / both all pass; only reception_only is rejected.
  const tier = (ctx.practice as any).product_tier ?? 'ehr_full'
  if (tier === 'reception_only') {
    return NextResponse.json(
      {
        error: 'product_tier_mismatch',
        message: 'Your practice is on the Reception Only tier. Upgrade to access EHR features.',
        current_tier: tier,
      },
      { status: 403 },
    )
  }
  return ctx
}

/**
 * W48 T6 — reusable tier guard. Pass an allowlist of product_tier
 * values; returns 403 product_tier_mismatch if the current practice's
 * tier isn't in it. Use for endpoints that only make sense for a
 * specific tier (e.g. Reception-only billing dashboards, EHR-specific
 * features that aren't covered by requireEhrApiSession).
 *
 * Usage:
 *   const ctx = await requireProductTier(['reception_only', 'both'])
 *   if (ctx instanceof NextResponse) return ctx
 */
/**
 * W51 D8 — guard for /api/reception/* routes. Allows every paying tier
 * (reception_only and all EHR tiers). Reception data is the universal
 * surface; EHR practices also use it for inbound call review.
 */
export async function requireReceptionApiSession(): Promise<ApiAuthContext | NextResponse> {
  return requireProductTier(['reception_only', 'ehr_full', 'ehr_only', 'both'] as Array<'reception_only' | 'ehr_full' | 'ehr_only' | 'both'>)
}

export async function requireProductTier(
  allowedTiers: Array<'ehr_full' | 'reception_only' | 'ehr_only' | 'both'>,
): Promise<ApiAuthContext | NextResponse> {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const tier = (ctx.practice as any)?.product_tier ?? 'ehr_full'
  if (!allowedTiers.includes(tier as any)) {
    return NextResponse.json(
      {
        error: 'product_tier_mismatch',
        message: `This endpoint is only available on the ${allowedTiers.join(' / ')} tier(s). Your practice is on ${tier}.`,
        current_tier: tier,
        allowed_tiers: allowedTiers,
      },
      { status: 403 },
    )
  }
  return ctx
}
