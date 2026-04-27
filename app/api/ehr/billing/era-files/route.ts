// app/api/ehr/billing/era-files/route.ts
//
// Wave 41 / T4 — list ERA files received by the practice + their
// status (matched / partially_matched / manual_review / error).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const status = req.nextUrl.searchParams.get('status')
  const conds = ['practice_id = $1']
  const args: unknown[] = [ctx.practiceId]
  if (status) { args.push(status); conds.push(`status = $${args.length}`) }

  const { rows } = await pool.query(
    `SELECT id, payer_name, check_or_eft_number, payment_method,
            payment_amount_cents, payment_date,
            status, parse_error, received_at
       FROM ehr_era_files
      WHERE ${conds.join(' AND ')}
      ORDER BY received_at DESC LIMIT 200`,
    args,
  )

  await auditEhrAccess({
    ctx,
    action: 'era.viewed',
    resourceType: 'ehr_era_file_list',
    resourceId: null,
    details: { count: rows.length, status_filter: status ?? null },
  })

  return NextResponse.json({ files: rows })
}
