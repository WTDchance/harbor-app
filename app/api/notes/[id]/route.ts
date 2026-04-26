// app/api/notes/[id]/route.ts
//
// Wave 23 (AWS port). Cognito + pool. Backs the "Notes" page (the
// generic dashboard notes — separate from /api/ehr/notes which is
// the clinical EHR). Reads from session_notes (Wave 14 schema).

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { getEffectivePracticeId } from '@/lib/active-practice'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { rows } = await pool.query(
    `SELECT * FROM session_notes WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, practiceId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Note not found' }, { status: 404 })
  return NextResponse.json({ note: rows[0] })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const updatable = new Set(['title', 'body', 'tags'])
  const sets: string[] = []
  const args: any[] = [id, practiceId]
  for (const [k, v] of Object.entries(body)) {
    if (!updatable.has(k)) continue
    args.push(v)
    sets.push(`${k} = $${args.length}`)
  }
  if (sets.length === 0) return NextResponse.json({ error: 'No updatable fields' }, { status: 400 })

  try {
    const { rows } = await pool.query(
      `UPDATE session_notes SET ${sets.join(', ')}
        WHERE id = $1 AND practice_id = $2
        RETURNING *`,
      args,
    )
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ note: rows[0] })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const practiceId = await getEffectivePracticeId(null, { email: ctx.session.email, id: ctx.user.id })
  if (!practiceId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { rowCount } = await pool.query(
    `DELETE FROM session_notes WHERE id = $1 AND practice_id = $2`,
    [id, practiceId],
  )
  if ((rowCount ?? 0) === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
