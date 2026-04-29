// W49 D6 — therapist licenses expiring within 60 days for this practice.

import { NextResponse } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT l.id, l.therapist_id, l.type, l.state, l.license_number, l.expires_at,
            t.display_name AS therapist_name,
            (l.expires_at::date - CURRENT_DATE) AS days_left
       FROM therapist_licenses l
       JOIN therapists t ON t.id = l.therapist_id
      WHERE l.practice_id = $1
        AND l.status = 'active'
        AND l.expires_at IS NOT NULL
        AND l.expires_at <= CURRENT_DATE + INTERVAL '60 days'
      ORDER BY l.expires_at ASC
      LIMIT 20`,
    [ctx.practiceId],
  ).catch(() => ({ rows: [] as any[] }))

  return NextResponse.json({ licenses: rows })
}
