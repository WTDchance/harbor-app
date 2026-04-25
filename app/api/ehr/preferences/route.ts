// EHR per-practice UI preferences. Reads from practices_ehr_preferences,
// returning null when the row (or column set) doesn't exist yet so callers
// fall back to defaults. PUT is a no-op stub — see TODO.

import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ preferences: null })

  // The table is created by the EHR migrations. If RDS doesn't have it yet
  // we treat it as "no preferences saved" rather than 500ing.
  try {
    const { rows } = await pool.query(
      `SELECT preferences FROM practices_ehr_preferences
        WHERE practice_id = $1 LIMIT 1`,
      [ctx.practiceId],
    )
    return NextResponse.json({ preferences: rows[0]?.preferences ?? null })
  } catch {
    return NextResponse.json({ preferences: null })
  }
}

// TODO(phase-4b): persist preferences to practices_ehr_preferences with an
// UPSERT. Currently a no-op so client-side saves don't 500.
export async function PUT() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  return NextResponse.json({ ok: true })
}
