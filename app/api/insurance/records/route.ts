// Insurance records list — read path on AWS.
//
// GET enriches each insurance_records row with its most recent
// eligibility_check via a single batched join. POST/PATCH/DELETE are
// 501-stubbed pending phase-4b (write paths overlap with the carrier-
// agnostic eligibility flow + Stedi).

import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ records: [] })

  // Try to load both tables. If insurance_records or eligibility_checks
  // doesn't exist on this RDS yet, return empty + setup_needed flag (mirrors
  // the legacy 42P01 fallback shape).
  let records: any[] = []
  let setupNeeded = false
  try {
    const r = await pool.query(
      `SELECT * FROM insurance_records
        WHERE practice_id = $1
        ORDER BY created_at DESC`,
      [ctx.practiceId],
    )
    records = r.rows
  } catch {
    return NextResponse.json({ records: [], setup_needed: true })
  }

  if (records.length === 0) return NextResponse.json({ records: [] })

  // Latest eligibility_check per record, joined manually.
  const ids = records.map(r => r.id)
  let checksByRecord = new Map<string, any>()
  try {
    const { rows: checks } = await pool.query(
      `SELECT insurance_record_id, id, status, is_active, mental_health_covered,
              copay_amount, deductible_total, deductible_met, checked_at,
              error_message
         FROM eligibility_checks
        WHERE insurance_record_id = ANY($1::uuid[])
        ORDER BY checked_at DESC`,
      [ids],
    )
    for (const c of checks) {
      if (!checksByRecord.has(c.insurance_record_id)) {
        checksByRecord.set(c.insurance_record_id, c)
      }
    }
  } catch {
    setupNeeded = true
  }

  const enriched = records.map(r => ({
    ...r,
    latest_check: checksByRecord.get(r.id) ?? null,
  }))
  return NextResponse.json({
    records: enriched,
    ...(setupNeeded ? { setup_needed: true } : {}),
  })
}

// TODO(phase-4b): port POST (create insurance record), PATCH (update fields),
// DELETE (?id=). All single-row writes, no external side effects — held back
// to keep this Wave 9 commit tightly read-shaped per the brief.
export async function POST() {
  return NextResponse.json(
    { error: 'insurance_record_create_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
export async function PATCH() {
  return NextResponse.json(
    { error: 'insurance_record_update_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
export async function DELETE() {
  return NextResponse.json(
    { error: 'insurance_record_delete_not_implemented_on_aws_yet' },
    { status: 501 },
  )
}
