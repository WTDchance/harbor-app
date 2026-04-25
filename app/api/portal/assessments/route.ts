// Patient portal — list assigned + completed assessments for the
// signed-in patient. The /api/portal/assessments/[id] route (which scores
// submissions) stays Supabase pending phase-4b.

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
      `SELECT id, assessment_type, status, score, severity,
              assigned_at, expires_at, completed_at, created_at
         FROM patient_assessments
        WHERE practice_id = $1 AND patient_id = $2
        ORDER BY created_at DESC
        LIMIT 20`,
      [sess.practiceId, sess.patientId],
    )
    .catch(() => ({ rows: [] as any[] }))

  auditPortalAccess({
    session: sess,
    action: 'portal.assessment.list',
    resourceType: 'patient_assessment',
    details: { count: rows.length },
  }).catch(() => {})

  return NextResponse.json({ assessments: rows })
}
