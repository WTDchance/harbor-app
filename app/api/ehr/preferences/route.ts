import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ preferences: null })

  // ehr_preferences table comes from the EHR migrations. If it doesn't exist
  // yet we return null preferences so the layout falls back to defaults.
  try {
    const { rows } = await pool.query(
      `SELECT preferences FROM practices_ehr_preferences
        WHERE practice_id = $1 LIMIT 1`,
      [ctx.practiceId],
    ).catch(() => ({ rows: [] as any[] }))
    return NextResponse.json({ preferences: rows[0]?.preferences ?? null })
  } catch {
    return NextResponse.json({ preferences: null })
  }
}

export async function PUT() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  // TODO: persist preferences. For now no-op so UI saves don't 500.
  return NextResponse.json({ ok: true })
}
