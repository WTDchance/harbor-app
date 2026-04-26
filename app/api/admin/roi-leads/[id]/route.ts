// Update one ROI lead row — stage, notes, next-action timestamp,
// converted_practice_id. Auto-stamps contacted_at the first time we move
// past 'new'. Auto-sets stage='won' when converted_practice_id is set.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdminSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STAGES = [
  'new', 'contacted', 'demo_booked', 'proposal_sent',
  'won', 'lost', 'unresponsive',
] as const
type Stage = typeof STAGES[number]

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const body = await req.json().catch(() => ({})) as any
  const sets: string[] = []
  const args: unknown[] = []

  if (typeof body.stage === 'string') {
    if (!(STAGES as readonly string[]).includes(body.stage)) {
      return NextResponse.json(
        { error: `Invalid stage. Must be one of: ${STAGES.join(', ')}` },
        { status: 400 },
      )
    }
    args.push(body.stage as Stage)
    sets.push(`stage = $${args.length}`)
    if (body.stage !== 'new') {
      // Auto-stamp contacted_at the first time we move past 'new'.
      const lookup = await pool.query(
        `SELECT contacted_at FROM roi_calculator_submissions
          WHERE id = $1 LIMIT 1`,
        [id],
      ).catch(() => ({ rows: [] as any[] }))
      if (lookup.rows[0] && !lookup.rows[0].contacted_at) {
        args.push(new Date().toISOString())
        sets.push(`contacted_at = $${args.length}`)
        args.push(ctx.session.email)
        sets.push(`contacted_by = $${args.length}`)
      }
    }
  }

  if ('notes' in body) {
    args.push(typeof body.notes === 'string' ? body.notes : null)
    sets.push(`notes = $${args.length}`)
  }

  if ('next_action_at' in body) {
    args.push(body.next_action_at || null)
    sets.push(`next_action_at = $${args.length}`)
  }

  if ('converted_practice_id' in body) {
    args.push(body.converted_practice_id || null)
    sets.push(`converted_practice_id = $${args.length}`)
    if (body.converted_practice_id) {
      args.push('won' as Stage)
      sets.push(`stage = $${args.length}`)
    }
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  sets.push('updated_at = NOW()')
  args.push(id)

  const { rows } = await pool.query(
    `UPDATE roi_calculator_submissions
        SET ${sets.join(', ')}
      WHERE id = $${args.length}
    RETURNING *`,
    args,
  )

  if (!rows[0]) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  return NextResponse.json({ lead: rows[0] })
}
