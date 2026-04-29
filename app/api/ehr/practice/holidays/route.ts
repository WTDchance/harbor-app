// app/api/ehr/practice/holidays/route.ts
//
// W43 T1 — list/create per-practice custom holidays. Federal holidays
// are always applied automatically; this route is for the rest
// (closure days, training days, in-service days, etc.).

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { usFederalHolidays } from '@/lib/aws/ehr/holidays'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 403 })

  const url = new URL(req.url)
  const yearParam = url.searchParams.get('year')
  const year = yearParam ? Number(yearParam) : new Date().getUTCFullYear()

  const customRes = await pool.query(
    `SELECT id, holiday_date::text AS date, name, notes, created_at
       FROM ehr_practice_holidays
      WHERE practice_id = $1
        AND extract(year from holiday_date)::int = $2
      ORDER BY holiday_date ASC`,
    [ctx.practiceId, year],
  )

  return NextResponse.json({
    year,
    federal: usFederalHolidays(year),
    custom: customRes.rows,
  })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const date = String(body.date || '').slice(0, 10)
  const name = String(body.name || '').trim()
  const notes = body.notes ? String(body.notes).slice(0, 500) : null

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  try {
    const ins = await pool.query(
      `INSERT INTO ehr_practice_holidays
         (practice_id, holiday_date, name, notes, created_by)
       VALUES ($1, $2::date, $3, $4, $5)
       ON CONFLICT (practice_id, holiday_date) DO UPDATE
         SET name = EXCLUDED.name, notes = EXCLUDED.notes
       RETURNING id, holiday_date::text AS date, name, notes`,
      [ctx.practiceId, date, name, notes, ctx.user.id],
    )
    await auditEhrAccess({
      ctx,
      action: 'note.create',
      resourceType: 'practice_holiday',
      resourceId: ins.rows[0].id,
      details: { kind: 'practice_holiday_created' },
    })
    return NextResponse.json({ holiday: ins.rows[0] }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 403 })

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const del = await pool.query(
    `DELETE FROM ehr_practice_holidays
      WHERE id = $1 AND practice_id = $2
      RETURNING id`,
    [id, ctx.practiceId],
  )
  if (del.rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'note.create',
    resourceType: 'practice_holiday',
    resourceId: id,
    details: { kind: 'practice_holiday_deleted' },
  })
  return NextResponse.json({ ok: true })
}
