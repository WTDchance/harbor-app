// app/api/portal/event-types/route.ts
//
// W49 D4 — patient-facing read-only list of bookable event types.
// Used by the portal scheduling card to show selectable event-type cards.

import { NextResponse } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const { rows } = await pool.query(
    `SELECT id, name, slug, color, default_duration_minutes,
            allows_telehealth, allows_in_person
       FROM calendar_event_types
      WHERE practice_id = $1 AND status = 'active'
      ORDER BY sort_order ASC, name ASC`,
    [sess.practiceId],
  )
  return NextResponse.json({ event_types: rows })
}
