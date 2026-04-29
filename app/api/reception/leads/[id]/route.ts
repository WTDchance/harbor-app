// app/api/reception/leads/[id]/route.ts
//
// W51 D2 — get / patch a single lead.

import { NextResponse, type NextRequest } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'
import { deliverLeadEvent } from '@/lib/lead-webhooks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = new Set(['new', 'contacted', 'scheduled', 'imported_to_ehr', 'discarded'])
const URGENCIES = new Set(['low', 'medium', 'high', 'crisis'])

const FIELDS = [
  'first_name', 'last_name', 'date_of_birth', 'phone_e164', 'email',
  'insurance_payer', 'insurance_member_id', 'insurance_group_number',
  'reason_for_visit', 'urgency_level', 'preferred_therapist',
  'preferred_appointment_window', 'notes',
]

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 400 })
  const { id } = await params

  const { rows } = await pool.query(
    `SELECT * FROM reception_leads WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, ctx.practiceId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ lead: rows[0] })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 400 })
  const { id } = await params

  const body = await req.json().catch(() => null) as Record<string, any> | null
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const sets: string[] = []
  const args: any[] = []
  for (const f of FIELDS) {
    if (body[f] !== undefined) {
      args.push(body[f] === '' ? null : body[f])
      sets.push(`${f} = $${args.length}`)
    }
  }
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
    args.push(body.status); sets.push(`status = $${args.length}`)
  }
  if (body.urgency_level !== undefined && body.urgency_level !== null && !URGENCIES.has(body.urgency_level)) {
    return NextResponse.json({ error: 'invalid_urgency' }, { status: 400 })
  }
  if (sets.length === 0) return NextResponse.json({ error: 'no_changes' }, { status: 400 })

  args.push(id, ctx.practiceId)
  const upd = await pool.query(
    `UPDATE reception_leads SET ${sets.join(', ')}
      WHERE id = $${args.length - 1} AND practice_id = $${args.length}
      RETURNING *`,
    args,
  )
  if (upd.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await writeAuditLog({
    practice_id: ctx.practiceId, user_id: ctx.user.id,
    action: 'reception_lead.updated',
    resource_type: 'reception_lead', resource_id: id,
  })

  void deliverLeadEvent('lead.updated', { ...upd.rows[0], practice_id: ctx.practiceId })
  return NextResponse.json({ lead: upd.rows[0] })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 400 })
  const { id } = await params

  // Soft-discard rather than hard-delete.
  const upd = await pool.query(
    `UPDATE reception_leads SET status = 'discarded' WHERE id = $1 AND practice_id = $2 RETURNING id`,
    [id, ctx.practiceId],
  )
  if (upd.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await writeAuditLog({
    practice_id: ctx.practiceId, user_id: ctx.user.id,
    action: 'reception_lead.discarded',
    resource_type: 'reception_lead', resource_id: id,
  })
  return NextResponse.json({ ok: true })
}
