// app/api/ehr/patients/[id]/custom-form-responses/route.ts
//
// W49 D1 — list custom form responses + assignments for a patient.

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

  // Verify patient.
  const p = await pool.query(
    `SELECT id FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [patientId, ctx.practiceId],
  )
  if (p.rows.length === 0) return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })

  const { rows: assignments } = await pool.query(
    `SELECT a.id, a.form_id, a.token, a.status, a.sent_at, a.opened_at,
            a.submitted_at, a.token_expires_at, a.schema_snapshot,
            f.name AS form_name, f.slug AS form_slug,
            r.id AS response_id, r.response, r.history, r.submitted_ip
       FROM patient_custom_form_assignments a
       JOIN practice_custom_forms f ON f.id = a.form_id
       LEFT JOIN patient_custom_form_responses r ON r.assignment_id = a.id
      WHERE a.practice_id = $1 AND a.patient_id = $2
      ORDER BY a.sent_at DESC
      LIMIT 200`,
    [ctx.practiceId, patientId],
  )

  await auditEhrAccess({
    ctx,
    action: 'custom_form.response_viewed',
    resourceType: 'patient_custom_form_response',
    details: { patient_id: patientId, count: assignments.length },
  })

  return NextResponse.json({ assignments })
}
