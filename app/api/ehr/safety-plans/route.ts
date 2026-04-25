// Harbor EHR — list + create Stanley-Brown safety plans.
// Same one-active-plan-per-patient invariant as treatment plans: creating a
// new active plan demotes any prior active plan to 'revised'.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const patientId = req.nextUrl.searchParams.get('patient_id')
  const conds: string[] = ['practice_id = $1']
  const args: unknown[] = [ctx.practiceId]
  if (patientId) { args.push(patientId); conds.push(`patient_id = $${args.length}`) }

  const { rows } = await pool.query(
    `SELECT * FROM ehr_safety_plans
      WHERE ${conds.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT 200`,
    args,
  )

  await auditEhrAccess({
    ctx,
    action: 'safety_plan.list',
    resourceType: 'ehr_safety_plan',
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
      `UPDATE ehr_safety_plans
          SET status = 'revised', updated_at = NOW()
        WHERE practice_id = $1 AND patient_id = $2 AND status = 'active'`,
      [ctx.practiceId, body.patient_id],
    )
  }

  const { rows } = await pool.query(
    `INSERT INTO ehr_safety_plans (
       practice_id, patient_id,
       warning_signs, internal_coping, distraction_people_places,
       support_contacts, professional_contacts,
       means_restriction, reasons_for_living,
       status, created_by
     ) VALUES (
       $1, $2,
       $3::text[], $4::text[], $5::text[],
       $6::jsonb, $7::jsonb,
       $8, $9::text[],
       $10, $11
     ) RETURNING *`,
    [
      ctx.practiceId, body.patient_id,
      arr(body.warning_signs), arr(body.internal_coping), arr(body.distraction_people_places),
      JSON.stringify(Array.isArray(body.support_contacts) ? body.support_contacts : []),
      JSON.stringify(Array.isArray(body.professional_contacts) ? body.professional_contacts : []),
      body.means_restriction ?? null,
      arr(body.reasons_for_living),
      wantActive ? 'active' : body.status,
      ctx.user.id,
    ],
  )
  const plan = rows[0]

  await auditEhrAccess({
    ctx,
    action: 'safety_plan.create',
    resourceType: 'ehr_safety_plan',
    resourceId: plan.id,
    details: { patient_id: body.patient_id, status: plan.status },
  })
  return NextResponse.json({ plan }, { status: 201 })
}
