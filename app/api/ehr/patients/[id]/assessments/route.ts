// W52 D2 — list a patient's assessment administrations.
import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const { rows } = await pool.query(
    `SELECT a.id, a.assessment_slug, a.administered_via, a.status,
            a.raw_score, a.computed_score, a.crisis_flagged,
            a.started_at, a.completed_at, a.expires_at, a.created_at,
            d.name AS assessment_name, d.scope
       FROM assessment_administrations a
       LEFT JOIN assessment_definitions d ON d.slug = a.assessment_slug
      WHERE a.practice_id = $1 AND a.patient_id = $2
      ORDER BY a.completed_at DESC NULLS LAST, a.created_at DESC
      LIMIT 200`,
    [ctx.practiceId, patientId],
  )
  await auditEhrAccess({ ctx, action: 'assessment.list' as any, resourceType: 'assessment_administration', details: { patient_id: patientId, count: rows.length } })
  return NextResponse.json({ administrations: rows })
}
