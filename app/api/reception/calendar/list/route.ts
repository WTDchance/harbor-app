// W51 D3 — list calendar integrations for the practice.
import { NextResponse } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ integrations: [] })

  const { rows } = await pool.query(
    `SELECT id, therapist_id, provider, account_email, status,
            scopes, last_sync_at, access_token_expires_at, created_at
       FROM practice_calendar_integrations
      WHERE practice_id = $1
      ORDER BY status DESC, created_at DESC`,
    [ctx.practiceId],
  )
  return NextResponse.json({ integrations: rows })
}
