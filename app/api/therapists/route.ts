// Harbor — Therapist roster for the authenticated practice.
//
// GET  → list all therapists for ctx.practiceId (active + inactive)
// POST → not yet ported (write path); see TODO below.

import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ therapists: [] })

  const { rows } = await pool.query(
    `SELECT id, display_name, credentials, bio, is_primary, is_active,
            created_at, updated_at
       FROM therapists
      WHERE practice_id = $1
      ORDER BY is_active DESC, is_primary DESC, created_at ASC`,
    [ctx.practiceId],
  )
  return NextResponse.json({ therapists: rows })
}

// TODO(phase-4b): port POST. Logic: validate display_name, soft-cap bio at
// 3000 chars, demote any existing primary if is_primary=true, then insert.
// Two writes (demote + insert) want a transaction.
export async function POST() {
  return NextResponse.json(
    { error: 'therapist_create_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
