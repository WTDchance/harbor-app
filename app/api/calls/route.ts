// Recent call_logs for the authenticated practice. Powers the calls
// dashboard list view and a few overview cards.

import { NextResponse, type NextRequest } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { db, schema } from '@/lib/aws/db'
import { eq, desc } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ calls: [] })

  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 50)
  const rows = await db
    .select()
    .from(schema.callLogs)
    .where(eq(schema.callLogs.practiceId, ctx.practiceId))
    .orderBy(desc(schema.callLogs.startedAt))
    .limit(Math.min(limit, 200))
  return NextResponse.json({ calls: rows })
}
