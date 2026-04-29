// app/api/reception/leads/route.ts
//
// W51 D2 — list + create reception leads.

import { NextResponse, type NextRequest } from 'next/server'
import { requireReceptionApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'
import { deliverLeadEvent } from '@/lib/lead-webhooks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = new Set(['new', 'contacted', 'scheduled', 'imported_to_ehr', 'discarded'])

export async function GET(req: NextRequest) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ leads: [] })

  const sp = req.nextUrl.searchParams
  const status = sp.get('status')
  const search = sp.get('search')?.trim().toLowerCase()
  const limit = Math.min(500, Number(sp.get('limit')) || 200)

  const args: any[] = [ctx.practiceId]
  let cond = 'practice_id = $1'
  if (status && STATUSES.has(status)) { args.push(status); cond += ` AND status = $${args.length}` }
  if (search) {
    args.push(`%${search}%`)
    cond += ` AND (
      lower(first_name) LIKE $${args.length}
      OR lower(last_name) LIKE $${args.length}
      OR lower(coalesce(email, '')) LIKE $${args.length}
      OR lower(coalesce(phone_e164, '')) LIKE $${args.length}
    )`
  }

  const { rows } = await pool.query(
    `SELECT id, first_name, last_name, date_of_birth, phone_e164, email,
            insurance_payer, insurance_member_id, insurance_group_number,
            reason_for_visit, urgency_level, preferred_therapist,
            preferred_appointment_window, notes, status, exported_at,
            metadata, call_id, created_at, updated_at
       FROM reception_leads
      WHERE ${cond}
      ORDER BY created_at DESC
      LIMIT ${limit}`,
    args,
  )

  await writeAuditLog({
    practice_id: ctx.practiceId, user_id: ctx.user.id,
    action: 'reception_lead.list',
    resource_type: 'reception_lead',
    details: { count: rows.length, status_filter: status, search: !!search },
  })

  return NextResponse.json({ leads: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireReceptionApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 400 })

  const body = await req.json().catch(() => null) as Record<string, any> | null
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const fields = [
    'first_name', 'last_name', 'date_of_birth', 'phone_e164', 'email',
    'insurance_payer', 'insurance_member_id', 'insurance_group_number',
    'reason_for_visit', 'urgency_level', 'preferred_therapist',
    'preferred_appointment_window', 'notes', 'call_id',
  ]
  const values: any[] = []
  for (const f of fields) values.push(body[f] ?? null)
  const status = STATUSES.has(body.status) ? body.status : 'new'
  values.push(status)

  const ins = await pool.query(
    `INSERT INTO reception_leads
       (practice_id, first_name, last_name, date_of_birth, phone_e164, email,
        insurance_payer, insurance_member_id, insurance_group_number,
        reason_for_visit, urgency_level, preferred_therapist,
        preferred_appointment_window, notes, call_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id, status, created_at`,
    [ctx.practiceId, ...values],
  )

  await writeAuditLog({
    practice_id: ctx.practiceId, user_id: ctx.user.id,
    action: 'reception_lead.created',
    resource_type: 'reception_lead',
    resource_id: ins.rows[0].id,
  })

  void deliverLeadEvent('lead.created', { ...ins.rows[0], practice_id: ctx.practiceId })
  return NextResponse.json({ lead: ins.rows[0] }, { status: 201 })
}
