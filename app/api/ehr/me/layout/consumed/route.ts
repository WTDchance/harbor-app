// app/api/ehr/me/layout/consumed/route.ts
//
// W47 T0 — fire-and-forget ping that the user just rendered Today
// with their saved layout. Drives W48 onboarding refinement signal
// (which widgets are people actually keeping vs hiding).

import { NextResponse } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  await auditEhrAccess({
    ctx,
    action: 'user_layout.consumed',
    resourceType: 'user_layout',
    details: { surface: 'today' },
  })
  return NextResponse.json({ ok: true })
}
