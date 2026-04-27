// app/api/admin/audit-log/export/route.ts
//
// Wave 40 / P2 — CSV export of audit_logs filtered by the same
// query string the dashboard uses. PHI keys in `details` are
// redacted before serialization (see lib/aws/ehr/audit-log-sanitize).
//
// Hard-capped at MAX_EXPORT_ROWS to avoid OOM on a large practice's
// audit history. Practices needing the full archive should request
// it via the admin team (separate offline export pipeline).

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { sanitizeAuditDetails, csvCell } from '@/lib/aws/ehr/audit-log-sanitize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_EXPORT_ROWS = 50_000

export async function GET(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  const sp = req.nextUrl.searchParams
  const allPractices = sp.get('all_practices') === '1'
  const patientId = sp.get('patient_id')
  const actor = sp.get('actor')
  const action = sp.get('action')
  const dateFrom = sp.get('date_from')
  const dateTo = sp.get('date_to')

  const conds: string[] = []
  const args: unknown[] = []

  if (!allPractices && ctx.practiceId) {
    args.push(ctx.practiceId)
    conds.push(`practice_id = $${args.length}`)
  }
  if (patientId) {
    args.push(patientId)
    conds.push(
      `(resource_id = $${args.length} OR details->>'patient_id' = $${args.length} OR details->>'target_patient_id' = $${args.length})`,
    )
  }
  if (actor) {
    if (/^[0-9a-f-]{36}$/i.test(actor)) {
      args.push(actor)
      conds.push(`user_id = $${args.length}::uuid`)
    } else {
      args.push(`%${actor}%`)
      conds.push(`user_email ILIKE $${args.length}`)
    }
  }
  if (action) {
    args.push(`%${action}%`)
    conds.push(`action ILIKE $${args.length}`)
  }
  if (dateFrom) { args.push(dateFrom); conds.push(`timestamp >= $${args.length}::timestamptz`) }
  if (dateTo)   { args.push(dateTo);   conds.push(`timestamp <= $${args.length}::timestamptz`) }
  args.push(MAX_EXPORT_ROWS)

  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''
  const sql = `
    SELECT id, timestamp, user_id, user_email, practice_id,
           action, resource_type, resource_id, details, severity
      FROM audit_logs
      ${where}
     ORDER BY timestamp DESC, id DESC
     LIMIT $${args.length}
  `
  const { rows } = await pool.query(sql, args)

  const header = [
    'timestamp', 'user_id', 'user_email', 'practice_id',
    'action', 'resource_type', 'resource_id',
    'severity', 'details_sanitized',
  ].join(',') + '\n'

  const lines: string[] = [header]
  for (const r of rows) {
    const sanitized = sanitizeAuditDetails(r.details ?? {})
    lines.push([
      csvCell(new Date(r.timestamp).toISOString()),
      csvCell(r.user_id ?? ''),
      csvCell(r.user_email ?? ''),
      csvCell(r.practice_id ?? ''),
      csvCell(r.action ?? ''),
      csvCell(r.resource_type ?? ''),
      csvCell(r.resource_id ?? ''),
      csvCell(r.severity ?? ''),
      csvCell(sanitized),
    ].join(',') + '\n')
  }

  await auditEhrAccess({
    ctx,
    action: 'admin.audit_log.exported',
    resourceType: 'audit_log_export',
    resourceId: null,
    details: {
      row_count: rows.length,
      capped_at_max: rows.length >= MAX_EXPORT_ROWS,
      filters: {
        all_practices: allPractices,
        patient_id: patientId,
        actor: actor,
        action: action,
        date_from: dateFrom,
        date_to: dateTo,
      },
    },
  })

  const body = lines.join('')
  const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
