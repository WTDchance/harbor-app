// Returns the authenticated user's practice. Used by the dashboard layout
// and many pages to display practice name, phone numbers, and feature flags.

import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practice) {
    return NextResponse.json({ error: 'no_practice' }, { status: 404 })
  }

  const p = ctx.practice
  return NextResponse.json({
    practice: {
      id: p.id,
      name: p.name,
      slug: p.slug,
      timezone: p.timezone,
      provisioning_state: p.provisioning_state,
      voice_provider: p.voice_provider,
      twilio_phone_number: p.twilio_phone_number,
      signalwire_number: p.signalwire_number,
      greeting: p.greeting,
      ehr_enabled: p.ehr_enabled,
      founding_member: p.founding_member,
    },
    user: {
      role: ctx.user.role,
      full_name: ctx.user.full_name,
      email: ctx.session.email,
    },
  })
}
