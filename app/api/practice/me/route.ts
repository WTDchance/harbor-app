// Returns the authenticated user's practice. Used by dashboard layout +
// many pages to display practice name and feature flags.

import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/aws/session'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.slug, p.timezone, p.provisioning_state, p.voice_provider,
            p.twilio_phone_number, p.signalwire_number, p.greeting,
            COALESCE(p.ehr_enabled, false) AS ehr_enabled,
            p.founding_member, u.role, u.full_name AS user_full_name
       FROM users u
       LEFT JOIN practices p ON p.id = u.practice_id
      WHERE u.cognito_sub = $1
      LIMIT 1`,
    [session.sub],
  )
  const r = rows[0]
  if (!r?.id) {
    return NextResponse.json({ error: 'no_practice' }, { status: 404 })
  }
  return NextResponse.json({
    practice: {
      id: r.id, name: r.name, slug: r.slug, timezone: r.timezone,
      provisioning_state: r.provisioning_state, voice_provider: r.voice_provider,
      twilio_phone_number: r.twilio_phone_number, signalwire_number: r.signalwire_number,
      greeting: r.greeting, ehr_enabled: r.ehr_enabled, founding_member: r.founding_member,
    },
    user: { role: r.role, full_name: r.user_full_name, email: session.email },
  })
}
