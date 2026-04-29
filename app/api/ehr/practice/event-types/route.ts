// app/api/ehr/practice/event-types/route.ts
//
// W49 D4 — list + create event types.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'type'
}

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const status = req.nextUrl.searchParams.get('status') ?? 'active'
  const args: any[] = [ctx.practiceId]
  let cond = 'practice_id = $1'
  if (status !== 'all') { args.push(status); cond += ` AND status = $${args.length}` }

  const { rows } = await pool.query(
    `SELECT id, name, slug, color, default_duration_minutes, default_cpt_codes,
            requires_intake_form_id, allows_telehealth, allows_in_person,
            default_location_id, status, is_default, sort_order,
            created_at, updated_at
       FROM calendar_event_types
      WHERE ${cond}
      ORDER BY sort_order ASC, name ASC`,
    args,
  )

  await auditEhrAccess({
    ctx, action: 'event_type.list',
    resourceType: 'calendar_event_type', details: { count: rows.length },
  })

  return NextResponse.json({ event_types: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const name = String(body.name ?? '').trim().slice(0, 80)
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  const duration = Number(body.default_duration_minutes ?? 50)
  if (!Number.isFinite(duration) || duration < 5 || duration > 480) {
    return NextResponse.json({ error: 'invalid_duration' }, { status: 400 })
  }

  const cpt = Array.isArray(body.default_cpt_codes)
    ? body.default_cpt_codes.map((c: unknown) => String(c).trim().slice(0, 10)).filter(Boolean).slice(0, 10)
    : []

  const baseSlug = slugify(name)
  let slug = baseSlug
  for (let i = 2; i < 50; i++) {
    const r = await pool.query(`SELECT 1 FROM calendar_event_types WHERE practice_id = $1 AND slug = $2`, [ctx.practiceId, slug])
    if (r.rows.length === 0) break
    slug = `${baseSlug}-${i}`
  }

  const ins = await pool.query(
    `INSERT INTO calendar_event_types
       (practice_id, name, slug, color, default_duration_minutes, default_cpt_codes,
        requires_intake_form_id, allows_telehealth, allows_in_person, default_location_id,
        status, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, 'active', $11)
     RETURNING id, name, slug, color, default_duration_minutes, default_cpt_codes,
               requires_intake_form_id, allows_telehealth, allows_in_person,
               default_location_id, status, is_default, sort_order, created_at, updated_at`,
    [
      ctx.practiceId, name, slug,
      body.color ?? '#6b7280',
      duration, JSON.stringify(cpt),
      body.requires_intake_form_id || null,
      body.allows_telehealth !== false,
      body.allows_in_person !== false,
      body.default_location_id || null,
      Number.isInteger(body.sort_order) ? body.sort_order : 100,
    ],
  )

  await auditEhrAccess({
    ctx, action: 'event_type.create',
    resourceType: 'calendar_event_type', resourceId: ins.rows[0].id,
    details: { name, default_duration_minutes: duration, cpt_count: cpt.length },
  })

  return NextResponse.json({ event_type: ins.rows[0] }, { status: 201 })
}
