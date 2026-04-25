// Top-level session notes (legacy session_notes table — distinct from the
// EHR progress notes at /api/ehr/notes). Read path lights up the dashboard
// /notes page; write path stays on the legacy stack until phase-4b.

import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ notes: [] })

  // Table may not exist on every RDS — return empty list rather than 500.
  try {
    const { rows } = await pool.query(
      `SELECT * FROM session_notes
        WHERE practice_id = $1
        ORDER BY session_date DESC NULLS LAST, created_at DESC
        LIMIT 200`,
      [ctx.practiceId],
    )
    return NextResponse.json({ notes: rows })
  } catch {
    return NextResponse.json({ notes: [] })
  }
}

// TODO(phase-4b): port POST. Single insert into session_notes (no side
// effects) — quick port. Held back so we ship a small, easily-reverted
// commit boundary in this batch.
export async function POST() {
  return NextResponse.json(
    { error: 'session_note_create_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
