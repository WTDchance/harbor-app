// app/api/support/[id]/route.ts
//
// Wave 24 (AWS port). Support ticket detail GET + PATCH. Cognito +
// pool. Practice-scoped; admins see all tickets across practices.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase()

function isAdmin(email: string): boolean {
  return !!ADMIN_EMAIL && email.toLowerCase() === ADMIN_EMAIL
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const args: any[] = [id]
  let where = `id = $1`
  if (!isAdmin(ctx.session.email)) {
    if (!ctx.practiceId) return NextResponse.json({ error: 'No practice found' }, { status: 404 })
    args.push(ctx.practiceId)
    where += ` AND practice_id = $${args.length}`
  }

  const { rows } = await pool.query(
    `SELECT * FROM support_tickets WHERE ${where} LIMIT 1`,
    args,
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  return NextResponse.json({ ticket: rows[0] })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const admin = isAdmin(ctx.session.email)
  if (!admin && !ctx.practiceId) {
    return NextResponse.json({ error: 'No practice found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const allowed = new Set(['status', 'priority', 'dev_notes', 'resolution', 'assigned_to'])

  const sets: string[] = []
  const args: any[] = [id]
  for (const [k, v] of Object.entries(body)) {
    if (!allowed.has(k)) continue
    // Non-admin can only update status (to close their own tickets).
    if (!admin && k !== 'status') continue
    args.push(v)
    sets.push(`${k} = $${args.length}`)
  }
  if (sets.length === 0) return NextResponse.json({ error: 'No updatable fields' }, { status: 400 })

  if (body.status === 'resolved' || body.status === 'closed') {
    sets.push('resolved_at = NOW()')
  }
  sets.push('updated_at = NOW()')

  let where = `id = $1`
  if (!admin) {
    args.push(ctx.practiceId)
    where += ` AND practice_id = $${args.length}`
  }

  try {
    const { rows } = await pool.query(
      `UPDATE support_tickets SET ${sets.join(', ')}
        WHERE ${where}
        RETURNING *`,
      args,
    )
    if (rows.length === 0) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    return NextResponse.json({ ticket: rows[0] })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
