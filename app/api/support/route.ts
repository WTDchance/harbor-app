// Harbor — Support tickets for the authenticated practice.
//
// GET → list tickets (?status=, ?category=, ?limit=, ?offset=) with total
//        count for pagination. POST is not yet ported — see TODO below.

import { NextResponse, type NextRequest } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ tickets: [], total: 0 })

  const sp = req.nextUrl.searchParams
  const status = sp.get('status')
  const category = sp.get('category')
  const limit = Math.min(Number(sp.get('limit') ?? 50), 200)
  const offset = Math.max(Number(sp.get('offset') ?? 0), 0)

  const conds: string[] = ['practice_id = $1']
  const args: unknown[] = [ctx.practiceId]
  if (status && status !== 'all')     { args.push(status);   conds.push(`status = $${args.length}`) }
  if (category && category !== 'all') { args.push(category); conds.push(`category = $${args.length}`) }

  // Table may not exist on every RDS — return empty list rather than 500.
  try {
    const where = conds.join(' AND ')
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM support_tickets WHERE ${where}`,
      args,
    )
    args.push(limit, offset)
    const ticketsResult = await pool.query(
      `SELECT * FROM support_tickets
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    )
    return NextResponse.json({
      tickets: ticketsResult.rows,
      total: countResult.rows[0]?.total ?? 0,
    })
  } catch {
    return NextResponse.json({ tickets: [], total: 0 })
  }
}

// TODO(phase-4b): port POST (validate subject/description/category/priority,
// insert with status='open', tie to ctx.user.id).
export async function POST() {
  return NextResponse.json(
    { error: 'support_ticket_create_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
