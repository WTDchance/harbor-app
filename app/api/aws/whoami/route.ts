// Returns the authenticated user + their practice (incl. ehr_enabled flag).
// Used by the dashboard layout to populate the sidebar/nav and by client
// components that need to gate UI on practice features.

import { NextResponse } from 'next/server'
import { getApiSession } from '@/lib/aws/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await getApiSession()
  if (!ctx) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    sub: ctx.session.sub,
    email: ctx.session.email,
    emailVerified: ctx.session.emailVerified,
    role: ctx.user.role,
    practice: ctx.practice
      ? {
          id: ctx.practice.id,
          name: ctx.practice.name,
          ehrEnabled: ctx.practice.ehr_enabled === true,
          voiceProvider: ctx.practice.voice_provider,
          productTier: (ctx.practice as any).product_tier ?? 'ehr_full',
        }
      : null,
  })
}
