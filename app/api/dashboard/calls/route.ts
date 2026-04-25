import { NextResponse, type NextRequest } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { db, schema, pool } from '@/lib/aws/db'
import { eq, desc, and, gte, lte } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ totalCount: 0, recentCalls: [], crisisCount: 0 })

  const mode = req.nextUrl.searchParams.get('mode') ?? 'list'
  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')

  if (mode === 'stats') {
    // Daily stats: total calls in range + recent + crisis count
    const conds = [eq(schema.callLogs.practiceId, ctx.practiceId)]
    if (from) conds.push(gte(schema.callLogs.startedAt, new Date(from)))
    if (to) conds.push(lte(schema.callLogs.startedAt, new Date(to)))

    const totalRows = await db
      .select({ id: schema.callLogs.id })
      .from(schema.callLogs)
      .where(and(...conds))
    const totalCount = totalRows.length

    const recent = await db
      .select()
      .from(schema.callLogs)
      .where(and(...conds))
      .orderBy(desc(schema.callLogs.startedAt))
      .limit(5)

    const crisisRows = totalRows.length
      ? await db
          .select({ id: schema.callLogs.id })
          .from(schema.callLogs)
          .where(and(...conds, eq(schema.callLogs.crisisDetected, true)))
      : []

    return NextResponse.json({
      totalCount,
      recentCalls: recent,
      crisisCount: crisisRows.length,
    })
  }

  // Default: list mode
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 50), 200)
  const rows = await db
    .select()
    .from(schema.callLogs)
    .where(eq(schema.callLogs.practiceId, ctx.practiceId))
    .orderBy(desc(schema.callLogs.startedAt))
    .limit(limit)
  return NextResponse.json({ calls: rows, totalCount: rows.length })
}
