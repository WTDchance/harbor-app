// Patient portal — scheduling requests submitted by the signed-in patient.
//
// GET → list (read path, in this batch).
// POST (submit a new request) is a write path — stays Supabase pending
// phase-4b. Single insert, but it triggers therapist-side notifications,
// so keep its rollout deliberate.

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
      `SELECT id, preferred_windows, patient_note, therapist_note,
              duration_minutes, appointment_type, status, appointment_id,
              created_at, responded_at
         FROM ehr_scheduling_requests
        WHERE practice_id = $1 AND patient_id = $2
        ORDER BY created_at DESC`,
      [sess.practiceId, sess.patientId],
    )
    .catch(() => ({ rows: [] as any[] }))

  auditPortalAccess({
    session: sess,
    action: 'portal.scheduling.list',
    resourceType: 'ehr_scheduling_request',
    details: { count: rows.length },
  }).catch(() => {})

  return NextResponse.json({ requests: rows })
}

// TODO(phase-4b): port POST. Validates preferred_windows array, inserts
// row with status='pending'. Triggers therapist-side notification — port
// alongside the notification fan-out so we don't double-deliver during
// the cutover.
export async function POST() {
  return NextResponse.json(
    { error: 'scheduling_request_create_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
