// app/api/ehr/telehealth/[id]/message/route.ts
//
// W49 D2 — therapist sets / clears the message shown to the patient
// on the waiting room page.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const body = await req.json().catch(() => null)
  const msg = typeof body?.message === 'string' ? body.message.slice(0, 500).trim() : ''
  const clear = !msg

  const upd = await pool.query(
    `UPDATE telehealth_sessions
        SET therapist_message = $1
      WHERE id = $2 AND practice_id = $3 AND ended_at IS NULL
      RETURNING id, therapist_message`,
    [clear ? null : msg, id, ctx.practiceId],
  )
  if (upd.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({ session: upd.rows[0] })
}
