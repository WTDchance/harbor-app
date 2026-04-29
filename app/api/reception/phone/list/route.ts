// W51 D6 — list current numbers attached to the practice.
import { NextResponse } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ numbers: [] })

  const r = await pool.query(
    `SELECT signalwire_phone_number AS phone_number,
            signalwire_phone_number_sid AS sid
       FROM practices WHERE id = $1`,
    [ctx.practiceId],
  )
  const row = r.rows[0]
  const numbers = row?.phone_number ? [{ phone_number: row.phone_number, sid: row.sid }] : []
  return NextResponse.json({ numbers })
}
