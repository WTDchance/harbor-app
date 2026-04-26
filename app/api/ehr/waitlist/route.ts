// Practice waitlist list view. Sorted by composite_score DESC then
// created_at DESC. composite_score is computed by the cancellation-fill
// dispatcher when entries are evaluated.

import { NextResponse } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ entries: [] })

  const { rows } = await pool
    .query(
      `SELECT id, patient_name, patient_phone, patient_email,
              insurance_type, session_type, reason, priority, status,
              notes, flexible_day_time, opt_in_last_minute, opt_in_flash_fill,
              composite_score, created_at
         FROM waitlist
        WHERE practice_id = $1
        ORDER BY composite_score DESC NULLS LAST, created_at DESC
        LIMIT 200`,
      [ctx.practiceId],
    )
    .catch(() => ({ rows: [] as any[] }))

  return NextResponse.json({ entries: rows })
}
