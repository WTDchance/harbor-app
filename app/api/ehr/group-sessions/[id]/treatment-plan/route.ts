// app/api/ehr/group-sessions/[id]/treatment-plan/route.ts
//
// W46 T2 — group treatment plan CRUD.
//   GET    → current active plan for this session (or null)
//   POST   → create a new plan (demotes any existing 'active' plan)
//   PATCH  → update the plan body / title / goals
//
// Uses ehr_group_treatment_plans (same JSONB goals shape as
// ehr_treatment_plans so the existing UI renderer works for both).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = new Set(['draft', 'active', 'revised', 'completed', 'archived'])

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT id, title, presenting_problem, goals, frequency, status,
            start_date::text, review_date::text, signed_at, created_at, updated_at
       FROM ehr_group_treatment_plans
      WHERE practice_id = $1 AND group_session_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [ctx.practiceId, params.id],
  )
  return NextResponse.json({ plan: rows[0] || null })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const title = String(body.title || 'Group treatment plan').slice(0, 200)
  const presentingProblem = body.presenting_problem ? String(body.presenting_problem) : null
  const goals = Array.isArray(body.goals) ? body.goals : []
  const frequency = body.frequency ? String(body.frequency) : null

  // Demote existing active.
  await pool.query(
    `UPDATE ehr_group_treatment_plans SET status = 'revised'
      WHERE practice_id = $1 AND group_session_id = $2 AND status = 'active'`,
    [ctx.practiceId, params.id],
  )

  const ins = await pool.query(
    `INSERT INTO ehr_group_treatment_plans
       (practice_id, group_session_id, title, presenting_problem,
        goals, frequency, status, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'active', $7)
     RETURNING id, title, presenting_problem, goals, frequency, status,
               start_date::text, review_date::text, created_at`,
    [ctx.practiceId, params.id, title, presentingProblem, JSON.stringify(goals), frequency, ctx.user.id],
  )

  await auditEhrAccess({
    ctx,
    action: 'group_session.plan_updated',
    resourceType: 'ehr_group_treatment_plan',
    resourceId: ins.rows[0].id,
    details: { kind: 'created', goal_count: goals.length },
  })
  return NextResponse.json({ plan: ins.rows[0] }, { status: 201 })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body?.plan_id) return NextResponse.json({ error: 'plan_id required' }, { status: 400 })

  const fields: string[] = []
  const args: any[] = []
  if (body.title !== undefined) { args.push(String(body.title)); fields.push(`title = $${args.length}`) }
  if (body.presenting_problem !== undefined) {
    args.push(body.presenting_problem ? String(body.presenting_problem) : null)
    fields.push(`presenting_problem = $${args.length}`)
  }
  if (Array.isArray(body.goals)) {
    args.push(JSON.stringify(body.goals)); fields.push(`goals = $${args.length}::jsonb`)
  }
  if (body.frequency !== undefined) {
    args.push(body.frequency ? String(body.frequency) : null)
    fields.push(`frequency = $${args.length}`)
  }
  if (body.status !== undefined && STATUSES.has(body.status)) {
    args.push(body.status); fields.push(`status = $${args.length}`)
  }
  if (fields.length === 0) return NextResponse.json({ error: 'no_fields' }, { status: 400 })

  args.push(body.plan_id, ctx.practiceId, params.id)
  const { rowCount } = await pool.query(
    `UPDATE ehr_group_treatment_plans SET ${fields.join(', ')}
      WHERE id = $${args.length - 2} AND practice_id = $${args.length - 1} AND group_session_id = $${args.length}`,
    args,
  )
  if (rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'group_session.plan_updated',
    resourceType: 'ehr_group_treatment_plan',
    resourceId: body.plan_id,
    details: { kind: 'updated', fields_changed: fields.length },
  })
  return NextResponse.json({ ok: true })
}
