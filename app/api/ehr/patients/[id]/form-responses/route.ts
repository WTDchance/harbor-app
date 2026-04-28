// app/api/ehr/patients/[id]/form-responses/route.ts
//
// W47 T2 — therapist read of a patient's submitted form responses.
// Joins ehr_custom_form_responses to ehr_custom_forms for the name
// + question shape so the UI can render labels from question IDs.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT r.id, r.form_id, r.responses, r.submitted_by, r.submitted_at,
            f.name AS form_name, f.kind AS form_kind, f.questions AS form_questions
       FROM ehr_custom_form_responses r
       JOIN ehr_custom_forms f ON f.id = r.form_id
      WHERE r.practice_id = $1 AND r.patient_id = $2
      ORDER BY r.submitted_at DESC
      LIMIT 100`,
    [ctx.practiceId, params.id],
  )

  await auditEhrAccess({
    ctx, action: 'custom_form.responded' as any,
    resourceType: 'ehr_custom_form_response', resourceId: params.id,
    details: { kind: 'list_view', count: rows.length },
  })

  return NextResponse.json({ responses: rows })
}
