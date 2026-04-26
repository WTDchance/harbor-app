// app/api/ehr/homework/[id]/route.ts
//
// Wave 22 (AWS port). Therapist updates / cancels assigned homework.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'

const UPDATABLE = new Set(['title', 'description', 'due_date', 'status'])

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const sets: string[] = []
  const args: any[] = [id, ctx.practiceId]
  for (const [k, v] of Object.entries(body)) {
    if (!UPDATABLE.has(k)) continue
    args.push(v)
    sets.push(`${k} = $${args.length}`)
  }
  if (body.status === 'completed') {
    sets.push('completed_at = NOW()')
  }
  if (sets.length === 0) return NextResponse.json({ error: 'No updatable fields' }, { status: 400 })

  try {
    const { rows } = await pool.query(
      `UPDATE ehr_homework SET ${sets.join(', ')}
        WHERE id = $1 AND practice_id = $2
        RETURNING *`,
      args,
    )
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ homework: rows[0] })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
