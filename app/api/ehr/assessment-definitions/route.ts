// W52 D2 — list assessment definitions.
import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT slug, name, short_description, question_count, questions, scoring_rules,
            estimated_minutes, call_administrable, scope, source_citation
       FROM assessment_definitions ORDER BY scope, name`,
  )
  return NextResponse.json({ definitions: rows })
}
