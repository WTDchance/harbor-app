// app/api/practices/[id]/route.ts
//
// Wave 23 (AWS port). PATCH updates the DB row only. Vapi assistant
// sync is CARVED — the legacy version pushed system_prompt + voice +
// firstMessage to Vapi after the UPDATE. Vapi is being replaced with
// Retell + SignalWire (Bucket 1), so we don't try to keep the legacy
// sync in step. Once Bucket 1 wires the carrier we'll re-attach the
// downstream sync from there.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase()
  const isAdmin = !!adminEmail && ctx.session.email.toLowerCase() === adminEmail

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const { rows: pRows } = await pool.query(
    `SELECT id, owner_email FROM practices WHERE id = $1 LIMIT 1`,
    [id],
  )
  if (pRows.length === 0) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

  if (!isAdmin && pRows[0].owner_email?.toLowerCase() !== ctx.session.email.toLowerCase()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Build dynamic UPDATE — drop practice_id from body if present.
  const fields = Object.entries(body).filter(([k]) => k !== 'id' && k !== 'practice_id')
  if (fields.length === 0) {
    return NextResponse.json({ error: 'No fields supplied' }, { status: 400 })
  }
  const sets: string[] = []
  const args: any[] = [id]
  for (const [k, v] of fields) {
    args.push(v)
    sets.push(`${k} = $${args.length}`)
  }

  try {
    await pool.query(
      `UPDATE practices SET ${sets.join(', ')} WHERE id = $1`,
      args,
    )
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    carrier_sync: 'deferred_to_bucket_1',
    note: 'Vapi assistant config sync moved to the Retell + SignalWire migration track.',
  })
}
