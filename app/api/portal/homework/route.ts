// Patient portal — homework assignments for the signed-in patient.
// PATCH on /api/portal/homework/[id] (mark complete) is a write path —
// stays Supabase pending phase-4b.

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
      `SELECT id, title, description, due_date, status,
              completed_at, created_at
         FROM ehr_homework
        WHERE practice_id = $1 AND patient_id = $2
        ORDER BY created_at DESC
        LIMIT 50`,
      [sess.practiceId, sess.patientId],
    )
    .catch(() => ({ rows: [] as any[] }))

  auditPortalAccess({
    session: sess,
    action: 'portal.homework.list',
    resourceType: 'ehr_homework',
    details: { count: rows.length },
  }).catch(() => {})

  return NextResponse.json({ homework: rows })
}
