import { NextResponse, type NextRequest } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { db, schema } from '@/lib/aws/db'
import { eq, desc } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ patients: [], completedForms: [], pendingForms: [] })

  const patients = await db
    .select()
    .from(schema.patients)
    .where(eq(schema.patients.practiceId, ctx.practiceId))
    .orderBy(desc(schema.patients.createdAt))
    .limit(200)

  const completed = await db
    .select()
    .from(schema.intakeForms)
    .where(eq(schema.intakeForms.practiceId, ctx.practiceId))
    .orderBy(desc(schema.intakeForms.completedAt))
    .limit(100)

  return NextResponse.json({
    patients,
    completedForms: completed.filter(f => f.status === 'completed'),
    pendingForms: completed.filter(f => f.status === 'sent' || f.status === 'opened'),
  })
}
