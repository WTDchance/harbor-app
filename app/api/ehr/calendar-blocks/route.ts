// app/api/ehr/calendar-blocks/route.ts
//
// W49 T5 — list + create personal calendar blocks. By default scoped
// to ctx.userId; admins / supervisors can pass ?user_id=other to
// view another user's blocks.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KINDS = new Set(['supervision','admin','lunch','vacation','training','other'])
const COLORS = new Set(['blue','green','yellow','red','gray','purple'])

function isoTs(s: string | null | undefined): string | null {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const sp = req.nextUrl.searchParams
  const fromIso = isoTs(sp.get('from')) ?? new Date().toISOString()
  const toIso = isoTs(sp.get('to')) ?? new Date(Date.now() + 90 * 86_400_000).toISOString()
  const userId = sp.get('user_id') || ctx.userId
  const allUsers = sp.get('all_users') === 'true'

  const conds: string[] = ['practice_id = $1', 'starts_at < $3', 'ends_at > $2']
  const args: any[] = [ctx.practiceId, fromIso, toIso]
  if (!allUsers) {
    args.push(userId)
    conds.push(`user_id = $${args.length}`)
  }

  const { rows } = await pool.query(
    `SELECT id, user_id::text, kind, title,
            starts_at::text, ends_at::text,
            is_recurring, recurrence_rule, color, notes,
            created_at::text, updated_at::text
       FROM ehr_calendar_blocks
      WHERE ${conds.join(' AND ')}
      ORDER BY starts_at ASC`,
    args,
  )
  return NextResponse.json({ blocks: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const kind = KINDS.has(body.kind) ? body.kind : 'admin'
  const color = COLORS.has(body.color) ? body.color : 'gray'
  const title = String(body.title || '').trim().slice(0, 200)
  const startsAt = isoTs(body.starts_at)
  const endsAt   = isoTs(body.ends_at)

  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
  if (!startsAt || !endsAt) {
    return NextResponse.json({ error: 'starts_at and ends_at required (ISO timestamps)' }, { status: 400 })
  }
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return NextResponse.json({ error: 'ends_at must be after starts_at' }, { status: 400 })
  }

  const isRecurring = !!body.is_recurring
  const recurrenceRule = isRecurring && typeof body.recurrence_rule === 'string'
    ? body.recurrence_rule.slice(0, 500)
    : null

  const ins = await pool.query(
    `INSERT INTO ehr_calendar_blocks
       (practice_id, user_id, kind, title, starts_at, ends_at,
        is_recurring, recurrence_rule, color, notes)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz,
             $7, $8, $9, $10)
     RETURNING id, user_id::text, kind, title,
               starts_at::text, ends_at::text,
               is_recurring, recurrence_rule, color, notes,
               created_at::text, updated_at::text`,
    [
      ctx.practiceId, ctx.userId, kind, title,
      startsAt, endsAt, isRecurring, recurrenceRule, color,
      body.notes ? String(body.notes).slice(0, 1000) : null,
    ],
  )

  await auditEhrAccess({
    ctx,
    action: 'calendar_block.created',
    resourceType: 'ehr_calendar_block',
    resourceId: ins.rows[0].id,
    details: { kind, is_recurring: isRecurring, color },
  })
  return NextResponse.json({ block: ins.rows[0] }, { status: 201 })
}
