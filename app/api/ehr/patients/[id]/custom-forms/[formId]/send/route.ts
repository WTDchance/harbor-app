// app/api/ehr/patients/[id]/custom-forms/[formId]/send/route.ts
//
// W49 D1 — send a custom form to a patient. Snapshots the form schema
// onto the assignment row and mints a portal-friendly token that can be
// surfaced in a patient-facing link / SMS without requiring portal login.

import { NextResponse, type NextRequest } from 'next/server'
import { randomBytes } from 'node:crypto'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function newToken(): string {
  return 'cf_' + randomBytes(24).toString('base64url')
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; formId: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId, formId } = await params

  // Verify patient + form both belong to the caller's practice.
  const { rows: pRows } = await pool.query(
    `SELECT id FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [patientId, ctx.practiceId],
  )
  if (pRows.length === 0) return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })

  const { rows: fRows } = await pool.query(
    `SELECT id, name, schema, status
       FROM practice_custom_forms
      WHERE id = $1 AND practice_id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    [formId, ctx.practiceId],
  )
  if (fRows.length === 0) return NextResponse.json({ error: 'form_not_found' }, { status: 404 })
  if (fRows[0].status !== 'published') {
    return NextResponse.json({ error: 'form_not_published' }, { status: 400 })
  }

  const token = newToken()
  const ins = await pool.query(
    `INSERT INTO patient_custom_form_assignments
       (practice_id, form_id, patient_id, token, schema_snapshot, sent_by_user_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id, token, status, sent_at, token_expires_at`,
    [ctx.practiceId, formId, patientId, token, JSON.stringify(fRows[0].schema), ctx.user.id],
  )

  await auditEhrAccess({
    ctx,
    action: 'custom_form.sent_to_patient',
    resourceType: 'patient_custom_form_assignment',
    resourceId: ins.rows[0].id,
    details: { form_id: formId, form_name: fRows[0].name, patient_id: patientId },
  })

  const base = process.env.NEXT_PUBLIC_APP_URL ?? ''
  return NextResponse.json({
    assignment: ins.rows[0],
    portal_url: `${base}/portal/forms/${token}`,
  }, { status: 201 })
}
