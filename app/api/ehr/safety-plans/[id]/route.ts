// app/api/ehr/safety-plans/[id]/route.ts
//
// Wave 22 (AWS port). GET + PATCH a safety plan. PATCH demotes any
// other 'active' plan for the same patient when promoting this one.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

const UPDATABLE = new Set([
  'warning_signs', 'internal_coping', 'distraction_people_places',
  'support_contacts', 'professional_contacts', 'means_restriction',
  'reasons_for_living', 'status',
])

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const { rows } = await pool.query(
    `SELECT * FROM ehr_safety_plans WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, ctx.practiceId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ plan: rows[0] })
}

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
  if (sets.length === 0) return NextResponse.json({ error: 'No updatable fields' }, { status: 400 })

  // If promoting to active, demote prior active for the same patient.
  if (body.status === 'active') {
    const { rows: pRows } = await pool.query(
      `SELECT patient_id FROM ehr_safety_plans
        WHERE id = $1 AND practice_id = $2 LIMIT 1`,
      [id, ctx.practiceId],
    )
    if (pRows[0]?.patient_id) {
      await pool.query(
        `UPDATE ehr_safety_plans SET status = 'revised'
          WHERE practice_id = $1 AND patient_id = $2
            AND status = 'active' AND id <> $3`,
        [ctx.practiceId, pRows[0].patient_id, id],
      )
    }
  }

  try {
    const { rows } = await pool.query(
      `UPDATE ehr_safety_plans SET ${sets.join(', ')}
        WHERE id = $1 AND practice_id = $2
        RETURNING *`,
      args,
    )
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await auditEhrAccess({
      ctx,
      action: 'note.update',
      resourceType: 'ehr_safety_plan',
      resourceId: id,
      details: { kind: 'safety_plan', fields: Object.keys(body).filter((k) => UPDATABLE.has(k)) },
    })
    return NextResponse.json({ plan: rows[0] })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
