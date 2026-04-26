// app/api/ehr/audit/route.ts
//
// Wave 20 (AWS port). Lists recent EHR audit events for the caller's
// practice. Read-only. Cognito + RDS pool. Backs the
// /dashboard/ehr/audit viewer (HIPAA forensic surface).
//
// Practice-scoped via requireEhrApiSession so a non-EHR practice
// can't list anyone's PHI access trail. Filters by resource_type =
// 'ehr_progress_note' to match the legacy view's scope; the
// admin-side full audit export at /api/admin/audit-export covers
// the broader surface.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10) || 200, 1000)
  const action = searchParams.get('action')
  const resourceId = searchParams.get('resource_id')
  const since = searchParams.get('since')

  const params: any[] = [ctx.practiceId]
  let where = `practice_id = $1 AND resource_type = 'ehr_progress_note'`
  if (action) {
    params.push(action)
    where += ` AND action = $${params.length}`
  }
  if (resourceId) {
    params.push(resourceId)
    where += ` AND resource_id = $${params.length}`
  }
  if (since) {
    params.push(since)
    where += ` AND timestamp >= $${params.length}`
  }
  params.push(limit)

  try {
    const { rows } = await pool.query(
      `SELECT id, timestamp, user_id, user_email, action, resource_type,
              resource_id, details, severity
         FROM audit_logs
        WHERE ${where}
        ORDER BY timestamp DESC
        LIMIT $${params.length}`,
      params,
    )
    return NextResponse.json({ events: rows })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
