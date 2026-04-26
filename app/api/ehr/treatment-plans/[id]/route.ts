// app/api/ehr/treatment-plans/[id]/route.ts
//
// Wave 22 (AWS port). GET + PATCH a treatment plan. PATCH demotes
// any other 'active' plan for the same patient when promoting this
// one.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

const UPDATABLE = new Set([
  'title', 'presenting_problem', 'diagnoses', 'goals', 'frequency',
  'start_date', 'review_date', 'status', 'therapist_id',
])

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const { rows } = await pool.query(
    `SELECT * FROM ehr_treatment_plans WHERE id = $1 AND practice_id = $2 LIMIT 1`,
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
    // diagnoses + goals are JSONB; stringify for safety
    if (k === 'diagnoses' || k === 'goals') {
      sets.push(`${k} = $${args.length}::jsonb`)
      args[args.length - 1] = JSON.stringify(v)
    } else {
      sets.push(`${k} = $${args.length}`)
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: 'No updatable fields' }, { status: 400 })

  if (body.status === 'active') {
    const { rows: pRows } = await pool.query(
      `SELECT patient_id FROM ehr_treatment_plans
        WHERE id = $1 AND practice_id = $2 LIMIT 1`,
      [id, ctx.practiceId],
    )
    if (pRows[0]?.patient_id) {
      await pool.query(
        `UPDATE ehr_treatment_plans SET status = 'revised'
          WHERE practice_id = $1 AND patient_id = $2
            AND status = 'active' AND id <> $3`,
        [ctx.practiceId, pRows[0].patient_id, id],
      )
    }
  }

  try {
    const { rows } = await pool.query(
      `UPDATE ehr_treatment_plans SET ${sets.join(', ')}
        WHERE id = $1 AND practice_id = $2
        RETURNING *`,
      args,
    )
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await auditEhrAccess({
      ctx,
      action: 'note.update',
      resourceType: 'ehr_treatment_plan',
      resourceId: id,
      details: { kind: 'treatment_plan', fields: Object.keys(body).filter((k) => UPDATABLE.has(k)) },
    })
    return NextResponse.json({ plan: rows[0] })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
