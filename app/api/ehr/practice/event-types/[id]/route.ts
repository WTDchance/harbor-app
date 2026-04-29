// W49 D4 — update / archive a single event type.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const sets: string[] = []
  const args: any[] = []

  for (const k of ['name', 'color']) {
    if ((body as any)[k] !== undefined) {
      args.push((body as any)[k] == null ? null : String((body as any)[k]).slice(0, 200))
      sets.push(`${k} = $${args.length}`)
    }
  }
  if (body.default_duration_minutes !== undefined) {
    const n = Number(body.default_duration_minutes)
    if (!Number.isFinite(n) || n < 5 || n > 480) return NextResponse.json({ error: 'invalid_duration' }, { status: 400 })
    args.push(n); sets.push(`default_duration_minutes = $${args.length}`)
  }
  if (body.default_cpt_codes !== undefined) {
    const arr = Array.isArray(body.default_cpt_codes)
      ? body.default_cpt_codes.map((c: unknown) => String(c).trim().slice(0, 10)).filter(Boolean).slice(0, 10)
      : []
    args.push(JSON.stringify(arr)); sets.push(`default_cpt_codes = $${args.length}::jsonb`)
  }
  for (const k of ['requires_intake_form_id', 'default_location_id']) {
    if ((body as any)[k] !== undefined) {
      args.push((body as any)[k] || null); sets.push(`${k} = $${args.length}`)
    }
  }
  for (const k of ['allows_telehealth', 'allows_in_person']) {
    if ((body as any)[k] !== undefined) {
      args.push(!!(body as any)[k]); sets.push(`${k} = $${args.length}`)
    }
  }
  if (body.status !== undefined) {
    if (!['active', 'archived'].includes(body.status)) return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
    args.push(body.status); sets.push(`status = $${args.length}`)
  }
  if (body.sort_order !== undefined) {
    args.push(Number(body.sort_order) || 0); sets.push(`sort_order = $${args.length}`)
  }
  if (body.is_default !== undefined) {
    if (body.is_default) {
      // Clear prior default first.
      await pool.query(`UPDATE calendar_event_types SET is_default = FALSE WHERE practice_id = $1`, [ctx.practiceId])
    }
    args.push(!!body.is_default); sets.push(`is_default = $${args.length}`)
  }

  if (sets.length === 0) return NextResponse.json({ error: 'no_changes' }, { status: 400 })
  args.push(id, ctx.practiceId)

  const upd = await pool.query(
    `UPDATE calendar_event_types
        SET ${sets.join(', ')}
      WHERE id = $${args.length - 1} AND practice_id = $${args.length}
      RETURNING id, name, slug, color, default_duration_minutes, default_cpt_codes,
                requires_intake_form_id, allows_telehealth, allows_in_person,
                default_location_id, status, is_default, sort_order, created_at, updated_at`,
    args,
  )
  if (upd.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx, action: 'event_type.update',
    resourceType: 'calendar_event_type', resourceId: id,
  })
  return NextResponse.json({ event_type: upd.rows[0] })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  // Soft archive — keep the FK on existing appointments valid.
  const upd = await pool.query(
    `UPDATE calendar_event_types
        SET status = 'archived', is_default = FALSE
      WHERE id = $1 AND practice_id = $2
      RETURNING id`,
    [id, ctx.practiceId],
  )
  if (upd.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx, action: 'event_type.delete',
    resourceType: 'calendar_event_type', resourceId: id,
  })
  return NextResponse.json({ ok: true })
}
