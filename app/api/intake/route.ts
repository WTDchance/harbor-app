// All intake form rows for the authenticated practice. Used by the intake
// dashboard list view (sent / opened / completed).

import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { db, schema } from '@/lib/aws/db'
import { eq, desc } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ submissions: [] })

  const rows = await db
    .select()
    .from(schema.intakeForms)
    .where(eq(schema.intakeForms.practiceId, ctx.practiceId))
    .orderBy(desc(schema.intakeForms.sentAt))
    .limit(200)
  return NextResponse.json({ submissions: rows })
}
