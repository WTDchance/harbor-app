// lib/billing/auth.ts — admin / owner gate for billing API routes.
//
// requireEhrApiSession() resolves the caller's practice but doesn't enforce
// "is this user an admin or owner?" — billing mutations need the stricter
// gate. This wraps requireApiSession() and rejects non-admin/owner users.

import { NextResponse } from 'next/server'
import { requireApiSession, type ApiAuthContext } from '@/lib/aws/api-auth'

export type BillingAuthContext = ApiAuthContext & { role: 'owner' | 'admin' }

/**
 * Rejects with 401 if not signed in, 403 if not owner/admin, otherwise
 * returns the auth context with the resolved role.
 */
export async function requireBillingAdmin(): Promise<BillingAuthContext | NextResponse> {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const role = (ctx.user.role ?? 'staff').toLowerCase()
  if (role !== 'owner' && role !== 'admin') {
    return NextResponse.json(
      { error: 'forbidden', reason: 'billing_admin_required' },
      { status: 403 },
    )
  }
  if (!ctx.practiceId) {
    return NextResponse.json({ error: 'no_practice' }, { status: 403 })
  }
  return { ...ctx, role: role as 'owner' | 'admin' }
}
