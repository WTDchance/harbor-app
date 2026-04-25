import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  return NextResponse.json({ ok: true })
}
