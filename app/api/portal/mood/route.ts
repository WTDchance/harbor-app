// Patient portal — mood check-ins.
// GET → list the patient's recent mood logs.
// POST → log a new mood entry. Validation: mood 1-10 required, anxiety 1-10
//        optional, sleep_hours numeric optional, note ≤500 chars.

import { NextResponse, type NextRequest } from 'next/server'
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

export async function POST(req: NextRequest) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess

  const body = await req.json().catch(() => null) as any
  const mood = Number(body?.mood)
  if (!Number.isInteger(mood) || mood < 1 || mood > 10) {
    return NextResponse.json({ error: 'mood must be an integer 1-10' }, { status: 400 })
  }

  const anxietyRaw = body?.anxiety
  let anxiety: number | null = null
  if (anxietyRaw != null && anxietyRaw !== '') {
    const a = Number(anxietyRaw)
    if (!Number.isInteger(a) || a < 1 || a > 10) {
      return NextResponse.json({ error: 'anxiety must be an integer 1-10' }, { status: 400 })
    }
    anxiety = a
  }

  let sleep: number | null = null
  if (body?.sleep_hours != null && body.sleep_hours !== '') {
    const s = Number(body.sleep_hours)
    if (!Number.isFinite(s) || s < 0 || s > 24) {
      return NextResponse.json({ error: 'sleep_hours must be 0-24' }, { status: 400 })
    }
    sleep = s
  }

  const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null

  const { rows } = await pool.query(
    `INSERT INTO ehr_mood_logs (
       practice_id, patient_id, mood, anxiety, sleep_hours, note
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [sess.practiceId, sess.patientId, mood, anxiety, sleep, note],
  )
  const log = rows[0]

  auditPortalAccess({
    session: sess,
    action: 'portal.mood.create',
    resourceType: 'ehr_mood_log',
    resourceId: log.id,
    details: { mood, anxiety, has_sleep: sleep !== null, has_note: !!note },
  }).catch(() => {})

  return NextResponse.json({ log }, { status: 201 })
}
