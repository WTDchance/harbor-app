// Dismisses the onboarding checklist for the authenticated user.
//
// TODO(phase-4b): persist the dismissal. For now this is a no-op so the
// client UI can call it without 500ing — the checklist visibility is
// re-derived from /api/onboarding/status on next load. Add a column on
// users (or a small user_meta table) and write through here.

import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  return NextResponse.json({ ok: true })
}
