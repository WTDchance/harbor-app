// W52 D4 — list ERA remittances + their match status.
import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const status = req.nextUrl.searchParams.get('status')
  const args: any[] = [ctx.practiceId]
  let cond = 'practice_id = $1'
  if (status && ['unmatched','partially_matched','fully_matched','disputed'].includes(status)) {
    args.push(status); cond += ` AND status = $${args.length}`
  }
  const { rows } = await pool.query(
    `SELECT id, payer_name, payer_id, check_or_eft_number, payment_amount_cents,
            payment_date, status, received_at,
            (SELECT COUNT(*) FROM era_claim_payments WHERE era_id = era_remittances.id)::int AS line_count,
            (SELECT COUNT(*) FROM era_claim_payments WHERE era_id = era_remittances.id AND matched_at IS NOT NULL)::int AS matched_count
       FROM era_remittances
      WHERE ${cond}
      ORDER BY received_at DESC LIMIT 200`,
    args,
  )
  return NextResponse.json({ remittances: rows })
}
