// Patient portal — list superbills issued to the signed-in patient.

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
      `SELECT id, from_date, to_date, total_cents, generated_at
         FROM ehr_superbills
        WHERE practice_id = $1 AND patient_id = $2
        ORDER BY generated_at DESC`,
      [sess.practiceId, sess.patientId],
    )
    .catch(() => ({ rows: [] as any[] }))

  auditPortalAccess({
    session: sess,
    action: 'portal.superbill.list',
    resourceType: 'ehr_superbill',
    details: { count: rows.length },
  }).catch(() => {})

  return NextResponse.json({ superbills: rows })
}
