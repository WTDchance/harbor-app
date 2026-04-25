// Patient portal — mood check-ins.
//
// GET → list the patient's recent mood logs (read path, in this batch).
// POST (log a new mood) is a write path — stays Supabase pending phase-4b.

import { NextResponse } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const { rows } = await pool
    .query(
      `SELECT id, mood, anxiety, sleep_hours, note, logged_at
         FROM ehr_mood_logs
        WHERE practice_id = $1 AND patient_id = $2
        ORDER BY logged_at DESC
        LIMIT 30`,
      [sess.practiceId, sess.patientId],
    )
    .catch(() => ({ rows: [] as any[] }))

  auditPortalAccess({
    session: sess,
    action: 'portal.mood.list',
    resourceType: 'ehr_mood_log',
    details: { count: rows.length },
  }).catch(() => {})

  return NextResponse.json({ logs: rows })
}

// TODO(phase-4b): port POST. Single insert with 1-10 validation on mood/
// anxiety, optional sleep_hours, 500-char note. Trivial; held back to
// keep this batch read-only foundation-grade for the native clients.
export async function POST() {
  return NextResponse.json(
    { error: 'mood_log_create_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
