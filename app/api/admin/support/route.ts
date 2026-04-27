// Admin — cross-practice support tickets list, with practice_name enriched.
// Filter: ?status=, ?priority=, ?limit= (default 100, hard cap 500).

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx

  const sp = req.nextUrl.searchParams
  const status = sp.get('status')
  const priority = sp.get('priority')
  const limit = Math.min(Number(sp.get('limit') ?? 100), 500)

  const conds: string[] = []
  const args: unknown[] = []
  if (status && status !== 'all')     { args.push(status);   conds.push(`status = $${args.length}`) }
  if (priority && priority !== 'all') { args.push(priority); conds.push(`priority = $${args.length}`) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  args.push(limit)

  // Tickets table may be missing on some clusters — return empty rather than 500.
  let tickets: any[] = []
  try {
    const { rows } = await pool.query(
      `SELECT * FROM support_tickets ${where} ORDER BY created_at DESC LIMIT $${args.length}`,
      args,
    )
    tickets = rows
  } catch {
    return NextResponse.json({ tickets: [] })
  }

  // Enrich with practice_name.
  if (tickets.length > 0) {
    const practiceIds = Array.from(new Set(tickets.map(t => t.practice_id).filter(Boolean)))
    if (practiceIds.length > 0) {
      const { rows: practices } = await pool.query(
        `SELECT id, name FROM practices WHERE id = ANY($1::uuid[])`,
        [practiceIds],
      )
      const nameById = new Map<string, string>(practices.map(p => [p.id, p.name]))
      for (const t of tickets) {
        t.practice_name = nameById.get(t.practice_id) ?? 'Unknown'
      }
    }
  }

  await auditEhrAccess({
    ctx,
    action: 'admin.support_ticket.list',
    resourceType: 'support_ticket_list',
    resourceId: null,
    details: {
      status,
      priority,
      limit,
      count: tickets.length,
      // Cap practice_ids in details to keep audit rows compact; the full
      // list is reconstructable from support_tickets by timestamp anyway.
      practice_ids_touched: Array.from(
        new Set(tickets.map((t: any) => t.practice_id).filter(Boolean)),
      ).slice(0, 50),
    },
  })
  return NextResponse.json({ tickets })
}
