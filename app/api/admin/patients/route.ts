// app/api/admin/patients/route.ts
//
// Wave 20 (AWS hotfix). Bare GET — list patients for a practice.
// Used by /dashboard/ehr/billing to resolve patient_id → name in the
// charge list. Legacy never had this route at /api/admin/patients
// (only /api/admin/patients/[id]); the billing page assumed it
// existed and silently fell through to an empty Map.
//
// Auth: requireAdminSession() — admin allowlist only. Practice-scoped
// via the required practice_id query param.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export async function GET(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  const practiceId = req.nextUrl.searchParams.get('practice_id')
  if (!practiceId) {
    return NextResponse.json({ error: 'practice_id required' }, { status: 400 })
  }

  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get('limit') || '500', 10) || 500,
    2000,
  )

  const { rows } = await pool.query(
    `SELECT id, first_name, last_name, email, phone, date_of_birth,
            patient_status, created_at
       FROM patients
      WHERE practice_id = $1 AND deleted_at IS NULL
      ORDER BY last_name NULLS LAST, first_name NULLS LAST
      LIMIT $2`,
    [practiceId, limit],
  )

  await auditEhrAccess({
    ctx,
    action: 'admin.patient.list',
    resourceType: 'patient_list',
    resourceId: practiceId,
    details: {
      target_practice_id: practiceId,
      limit,
      count: rows.length,
    },
  })
  return NextResponse.json({ patients: rows })
}
