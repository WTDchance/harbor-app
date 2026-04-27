// app/api/admin/audit-log/route.ts
//
// Wave 40 / P2 — HIPAA Privacy Officer view over audit_logs.
//
// Auth: requireAdminSession (ADMIN_EMAIL allowlist) + practice-scoped
// to ctx.practiceId. Per-practice privacy officers should be granted
// admin access for their own practice only; cross-practice global
// admins are gated by the same allowlist + opt in via ?all_practices=1.
//
// Pagination: cursor-based on (timestamp DESC, id DESC). audit_logs
// grows fast — offset pagination would scan deeply on later pages.
// Cursor is the base64 of "<timestamp>|<id>".

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

function decodeCursor(c: string | null): { ts: string; id: string } | null {
  if (!c) return null
  try {
    const raw = Buffer.from(c, 'base64url').toString('utf8')
    const [ts, id] = raw.split('|')
    if (!ts || !id) return null
    return { ts, id }
  } catch {
    return null
  }
}

function encodeCursor(ts: string, id: string): string {
  return Buffer.from(`${ts}|${id}`, 'utf8').toString('base64url')
}

export async function GET(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  const sp = req.nextUrl.searchParams
  const allPractices = sp.get('all_practices') === '1'
  const patientId = sp.get('patient_id')
  const actor = sp.get('actor') // user_email substring or user_id UUID
  const action = sp.get('action') // exact or substring
  const dateFrom = sp.get('date_from') // YYYY-MM-DD or ISO
  const dateTo = sp.get('date_to')
  const cursor = decodeCursor(sp.get('cursor'))
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(sp.get('page_size') ?? PAGE_SIZE)))

  const conds: string[] = []
  const args: unknown[] = []

  if (!allPractices && ctx.practiceId) {
    args.push(ctx.practiceId)
    conds.push(`practice_id = $${args.length}`)
  }

  if (patientId) {
    args.push(patientId)
    // Patient-scoped: matches when audit row's resource_id is the
    // patient OR details.patient_id field is the patient.
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

  if (dateFrom) {
    args.push(dateFrom)
    conds.push(`timestamp >= $${args.length}::timestamptz`)
  }
  if (dateTo) {
    args.push(dateTo)
    conds.push(`timestamp <= $${args.length}::timestamptz`)
  }

  // Cursor: keyset pagination.
  if (cursor) {
    args.push(cursor.ts, cursor.id)
    conds.push(
      `(timestamp, id) < ($${args.length - 1}::timestamptz, $${args.length}::uuid)`,
    )
  }

  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''
  args.push(pageSize + 1) // fetch one extra to know if there's a next page

  const sql = `
    SELECT id, timestamp, user_id, user_email, practice_id,
           action, resource_type, resource_id, details, severity
      FROM audit_logs
      ${where}
     ORDER BY timestamp DESC, id DESC
     LIMIT $${args.length}
  `
  const { rows } = await pool.query(sql, args)

  let nextCursor: string | null = null
  let entries = rows
  if (rows.length > pageSize) {
    entries = rows.slice(0, pageSize)
    const last = entries[entries.length - 1]
    nextCursor = encodeCursor(new Date(last.timestamp).toISOString(), last.id)
  }

  await auditEhrAccess({
    ctx,
    action: 'admin.audit_log.viewed',
    resourceType: 'audit_log_query',
    resourceId: null,
    details: {
      filters: {
        all_practices: allPractices,
        patient_id: patientId,
        actor: actor,
        action: action,
        date_from: dateFrom,
        date_to: dateTo,
      },
      page_size: pageSize,
      result_count: entries.length,
    },
  })

  return NextResponse.json({
    entries,
    next_cursor: nextCursor,
    page_size: pageSize,
  })
}
