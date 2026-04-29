// W50 D5 — POST a correction.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FIELDS = new Set(['patient_name', 'patient_dob', 'patient_phone', 'patient_email',
  'insurance_carrier', 'insurance_member_id', 'reason_for_call', 'urgency',
  'patient_match_id', 'outcome'])

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: callId } = await params

  const body = await req.json().catch(() => null) as
    { field_name?: string; original_value?: string | null; corrected_value?: string | null; notes?: string } | null
  if (!body || !body.field_name || !FIELDS.has(body.field_name)) {
    return NextResponse.json({ error: 'invalid_field' }, { status: 400 })
  }

  // Verify call belongs to this practice.
  const c = await pool.query(`SELECT 1 FROM call_logs WHERE id = $1 AND practice_id = $2`, [callId, ctx.practiceId])
  if (c.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const ins = await pool.query(
    `INSERT INTO receptionist_corrections
       (practice_id, call_id, field_name, original_value, corrected_value, corrected_by_user_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, field_name, original_value, corrected_value, corrected_at, notes`,
    [ctx.practiceId, callId, body.field_name,
     body.original_value ?? null, body.corrected_value ?? null,
     ctx.user.id, body.notes ?? null],
  )

  await auditEhrAccess({
    ctx, action: 'receptionist.correction.created',
    resourceType: 'receptionist_correction',
    resourceId: ins.rows[0].id,
    details: { call_id: callId, field_name: body.field_name },
  })
  return NextResponse.json({ correction: ins.rows[0] }, { status: 201 })
}
