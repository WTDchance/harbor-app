// Admin audit log endpoint — cross-practice visibility + CSV export.
//
// Auth: Bearer ${CRON_SECRET} (cron / ops endpoint, not Cognito user).
//
// GET /api/admin/audit-export
//   Query params:
//     practice_id  — filter to one practice (optional)
//     from         — ISO date start (optional, default 30 days ago)
//     to           — ISO date end (optional, default now)
//     action       — filter by action type (optional)
//     severity     — filter by severity level (optional)
//     format       — "json" (default) or "csv"
//     limit        — max rows (default 1000, hard cap 10000)
//     offset       — pagination offset (default 0)

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const sp = req.nextUrl.searchParams
  const practiceId = sp.get('practice_id')
  const action = sp.get('action')
  const severity = sp.get('severity')
  const format = sp.get('format') || 'json'
  const limit = Math.min(Number(sp.get('limit') ?? 1000), 10000)
  const offset = Math.max(Number(sp.get('offset') ?? 0), 0)

  const now = new Date()
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const from = sp.get('from') || defaultFrom.toISOString()
  const to = sp.get('to') || now.toISOString()

  const conds: string[] = ['timestamp >= $1', 'timestamp <= $2']
  const args: unknown[] = [from, to]
  if (practiceId) { args.push(practiceId); conds.push(`practice_id = $${args.length}`) }
  if (action)     { args.push(action);     conds.push(`action = $${args.length}`) }
  if (severity)   { args.push(severity);   conds.push(`severity = $${args.length}`) }
  const where = conds.join(' AND ')

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM audit_logs WHERE ${where}`,
    args,
  )
  args.push(limit, offset)
  const logsResult = await pool.query(
    `SELECT * FROM audit_logs
      WHERE ${where}
      ORDER BY timestamp DESC
      LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args,
  )
  const logs = logsResult.rows
  const total = countResult.rows[0]?.total ?? 0

  let practiceName: string | null = null
  if (practiceId) {
    const { rows } = await pool.query(
      `SELECT name FROM practices WHERE id = $1 LIMIT 1`,
      [practiceId],
    )
    practiceName = rows[0]?.name ?? null
  }

  if (format === 'csv') {
    const csvRows: string[] = []
    csvRows.push([
      'timestamp', 'action', 'severity', 'user_email', 'user_id',
      'practice_id', 'resource_type', 'resource_id',
      'ip_address', 'user_agent', 'details',
    ].join(','))
    for (const log of logs) {
      csvRows.push([
        csvEscape(log.timestamp),
        csvEscape(log.action),
        csvEscape(log.severity),
        csvEscape(log.user_email),
        csvEscape(log.user_id),
        csvEscape(log.practice_id),
        csvEscape(log.resource_type),
        csvEscape(log.resource_id),
        csvEscape(log.ip_address),
        csvEscape(log.user_agent),
        csvEscape(JSON.stringify(log.details || {})),
      ].join(','))
    }
    const csv = csvRows.join('\n')
    const dateSlug = now.toISOString().slice(0, 10)
    const nameSlug = practiceName
      ? practiceName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      : 'all-practices'
    const filename = `harbor-audit-${nameSlug}-${dateSlug}.csv`
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  return NextResponse.json({
    logs,
    total,
    practice_name: practiceName,
    filters: { practice_id: practiceId, from, to, action, severity },
    exported_at: now.toISOString(),
  })
}
