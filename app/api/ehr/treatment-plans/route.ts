// Harbor EHR — list + create treatment plans.
// Per-patient one-active-plan invariant: creating a new active plan demotes
// any existing active plan for the same patient to 'revised'.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const patientId = req.nextUrl.searchParams.get('patient_id')
  const conds: string[] = ['practice_id = $1']
  const args: unknown[] = [ctx.practiceId]
  if (patientId) { args.push(patientId); conds.push(`patient_id = $${args.length}`) }

  const { rows } = await pool.query(
    `SELECT id, patient_id, title, presenting_problem, diagnoses, goals,
            status, start_date, review_date, signed_at, created_at, updated_at
       FROM ehr_treatment_plans
      WHERE ${conds.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT 200`,
    args,
  )

  await auditEhrAccess({
    ctx,
    action: 'treatment_plan.list',
    resourceType: 'ehr_treatment_plan',
    details: { count: rows.length, patient_id: patientId },
  })
  return NextResponse.json({ plans: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body?.patient_id) {
    return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
  }

  const wantActive = body.status === 'active' || body.status === undefined
  if (wantActive) {
    await pool.query(
      `UPDATE ehr_treatment_plans
          SET status = 'revised', updated_at = NOW()
        WHERE practice_id = $1 AND patient_id = $2 AND status = 'active'`,
      [ctx.practiceId, body.patient_id],
    )
  }

  const { rows } = await pool.query(
    `INSERT INTO ehr_treatment_plans (
       practice_id, patient_id, title, presenting_problem,
       diagnoses, goals, frequency, start_date, review_date,
       status, created_by
     ) VALUES (
       $1, $2, $3, $4, $5::text[], $6::jsonb, $7, $8, $9, $10, $11
     ) RETURNING *`,
    [
      ctx.practiceId, body.patient_id,
      body.title || 'Treatment plan',
      body.presenting_problem ?? null,
      Array.isArray(body.diagnoses) ? body.diagnoses : [],
      JSON.stringify(Array.isArray(body.goals) ? body.goals : []),
      body.frequency ?? null,
      body.start_date ?? null,
      body.review_date ?? null,
      wantActive ? 'active' : body.status,
      ctx.user.id,
    ],
  )
  const plan = rows[0]

  await auditEhrAccess({
    ctx,
    action: 'treatment_plan.create',
    resourceType: 'ehr_treatment_plan',
    resourceId: plan.id,
    details: { patient_id: body.patient_id, status: plan.status },
  })
  return NextResponse.json({ plan }, { status: 201 })
}
