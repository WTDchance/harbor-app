import { NextResponse, type NextRequest } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { db, schema } from '@/lib/aws/db'
import { eq, desc, and } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) {
    return NextResponse.json({ submissions: [], pagination: { total: 0, limit: 0, offset: 0 } })
  }

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 50), 200)
  const status = req.nextUrl.searchParams.get('status')

  const conds = [eq(schema.intakeForms.practiceId, ctx.practiceId)]
  if (status) conds.push(eq(schema.intakeForms.status, status))

  const rows = await db
    .select()
    .from(schema.intakeForms)
    .where(and(...conds))
    .orderBy(desc(schema.intakeForms.sentAt))
    .limit(limit)

  return NextResponse.json({
    submissions: rows,
    pagination: { total: rows.length, limit, offset: 0 },
  })
}
