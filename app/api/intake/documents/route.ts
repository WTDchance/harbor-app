// Harbor — Practice Intake Documents API.
//
// GET → list documents for the authenticated practice (active + inactive,
//       ordered by sort_order then created_at).
//
// POST / PATCH / DELETE are not yet ported (write paths) — see TODOs below.

import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ documents: [] })

  // Table may not exist on every RDS — return empty list rather than 500.
  try {
    const { rows } = await pool.query(
      `SELECT id, name, requires_signature, content_url, description,
              active, sort_order, created_at, updated_at
         FROM intake_documents
        WHERE practice_id = $1
        ORDER BY sort_order ASC NULLS LAST, created_at ASC`,
      [ctx.practiceId],
    )
    return NextResponse.json({ documents: rows })
  } catch {
    return NextResponse.json({ documents: [] })
  }
}

// TODO(phase-4b): port POST (insert with sort_order = max+1).
export async function POST() {
  return NextResponse.json(
    { error: 'intake_document_create_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}

// TODO(phase-4b): port PATCH (whitelisted-field UPDATE).
export async function PATCH() {
  return NextResponse.json(
    { error: 'intake_document_update_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}

// TODO(phase-4b): port DELETE (soft-delete via active=false).
export async function DELETE() {
  return NextResponse.json(
    { error: 'intake_document_delete_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
