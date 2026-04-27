// app/api/admin/patients/[id]/route.ts
//
// Wave 18 (AWS port). Admin-only patient lookup + soft-delete.
//
// Auth: requireAdminSession() — Cognito session must match
// ADMIN_EMAIL allowlist.
//
// GET    /api/admin/patients/:id              → fetch patient by ID
// GET    /api/admin/patients/search?practice_id=&phone=
//                                              → search by phone within
//                                                a practice (last 10
//                                                digits, case-insensitive)
// DELETE /api/admin/patients/:id              → soft-delete (deleted_at
//                                                = NOW). NOT hard delete
//                                                — patient rows are PHI
//                                                and must be recoverable
//                                                under HIPAA. Legacy
//                                                cascaded-delete child
//                                                tables (intake_*, appts,
//                                                call_logs, sms_*) is
//                                                NOT replicated; those
//                                                rows stay so the
//                                                forensic trail survives.
//
// Audit captures admin email + patient_id + practice_id + payload hash.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { hashAdminPayload } from '@/lib/aws/admin/payload-hash'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  // Special case: id=search — look up by practice_id + optional phone.
  if (patientId === 'search') {
    const practiceId = req.nextUrl.searchParams.get('practice_id')
    const phone = req.nextUrl.searchParams.get('phone')
    if (!practiceId) {
      return NextResponse.json({ error: 'practice_id required' }, { status: 400 })
    }
    const params: any[] = [practiceId]
    let phoneClause = ''
    if (phone) {
      const normalized = phone.replace(/\D/g, '').slice(-10)
      params.push(`%${normalized}`)
      phoneClause = ` AND phone ILIKE $${params.length}`
    }
    const { rows } = await pool.query(
      `SELECT * FROM patients
        WHERE practice_id = $1 AND deleted_at IS NULL${phoneClause}
        ORDER BY created_at DESC LIMIT 20`,
      params,
    )
    return NextResponse.json({ patients: rows })
  }

  const { rows } = await pool.query(
    `SELECT * FROM patients WHERE id = $1 LIMIT 1`,
    [patientId],
  )
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json(rows[0])
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  if (!patientId) {
    return NextResponse.json({ error: 'Patient ID required' }, { status: 400 })
  }

  // Snapshot the row before mutation so the audit row carries enough
  // context to identify the patient without re-fetching the soft-
  // deleted record.
  const beforeRes = await pool.query(
    `SELECT id, first_name, last_name, practice_id, deleted_at
       FROM patients WHERE id = $1 LIMIT 1`,
    [patientId],
  )
  if (beforeRes.rows.length === 0) {
    return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
  }
  const before = beforeRes.rows[0]
  if (before.deleted_at) {
    return NextResponse.json(
      { ok: true, already_deleted: true, patient_id: patientId },
    )
  }

  await pool.query(
    `UPDATE patients SET deleted_at = NOW() WHERE id = $1`,
    [patientId],
  )

  const patientName = [before.first_name, before.last_name].filter(Boolean).join(' ') || 'Unknown'

  await auditEhrAccess({
    ctx,
    action: 'admin.patient.delete',
    resourceType: 'patient',
    resourceId: patientId,
    details: {
      // Wave 41 / T0 — patient_name removed (PHI). resource_id already
      // carries patientId; admin_email + target_practice_id + payload_hash
      // are sufficient for forensic linkage without storing PHI.
      admin_email: ctx.session.email,
      target_practice_id: before.practice_id,
      action: 'soft_delete',
      payload_hash: hashAdminPayload({ patient_id: patientId }),
    },
  })

  return NextResponse.json({
    success: true,
    soft_deleted: true,
    patient_id: patientId,
    patient_name: patientName,
    practice_id: before.practice_id,
  })
}
