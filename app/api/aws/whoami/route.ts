// Returns the authenticated Cognito user + their practice (incl. ehr_enabled
// flag). Used by the dashboard layout to populate the sidebar/nav.

import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/aws/session'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Single query: user + their practice (with the ehr-related columns the
  // legacy layout expects).
  let practice: { id: string; name: string; ehrEnabled: boolean; voiceProvider: string } | null = null
  let role: string | null = null
  try {
    const r = await pool.query(
      `SELECT u.role,
              p.id          AS practice_id,
              p.name        AS practice_name,
              COALESCE(p.ehr_enabled, false) AS ehr_enabled,
              p.voice_provider
         FROM users u
    LEFT JOIN practices p ON p.id = u.practice_id
        WHERE u.cognito_sub = $1
        LIMIT 1`,
      [session.sub],
    )
    if (r.rows[0]) {
      role = r.rows[0].role
      if (r.rows[0].practice_id) {
        practice = {
          id: r.rows[0].practice_id,
          name: r.rows[0].practice_name,
          ehrEnabled: r.rows[0].ehr_enabled === true,
          voiceProvider: r.rows[0].voice_provider,
        }
      }
    }
  } catch {
    // ehr_enabled column may not exist on this RDS yet — return without it
  }

  return NextResponse.json({
    sub: session.sub,
    email: session.email,
    emailVerified: session.emailVerified,
    role,
    practice,
  })
}
