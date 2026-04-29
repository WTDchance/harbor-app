// app/api/ehr/treatment-plan-templates/route.ts
//
// W43 T3 — list + create treatment plan templates. Templates are
// per-practice (not global) so a CBT practice's depression template
// looks different from a DBT practice's. Each template targets one or
// more ICD-10 codes via the `diagnoses` array.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  // Optional ?diagnosis=F32.1 filters to templates that include that code.
  const diag = req.nextUrl.searchParams.get('diagnosis')
  const showArchived = req.nextUrl.searchParams.get('archived') === 'true'

  const args: any[] = [ctx.practiceId]
  let where = `practice_id = $1`
  if (!showArchived) where += ` AND archived_at IS NULL`
  if (diag) {
    args.push(diag)
    where += ` AND $${args.length} = ANY(diagnoses)`
  }

  const { rows } = await pool.query(
    `SELECT id, name, description, diagnoses, presenting_problem,
            goals, frequency, archived_at, created_at, updated_at
       FROM ehr_treatment_plan_templates
      WHERE ${where}
      ORDER BY archived_at NULLS FIRST, name ASC
      LIMIT 200`,
    args,
  )

  return NextResponse.json({ templates: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const description = body.description ? String(body.description) : null
  const diagnoses: string[] = Array.isArray(body.diagnoses)
    ? body.diagnoses.map((d: any) => String(d).trim()).filter(Boolean)
    : []
  const presentingProblem = body.presenting_problem
    ? String(body.presenting_problem) : null
  const goals = Array.isArray(body.goals) ? body.goals : []
  const frequency = body.frequency ? String(body.frequency) : null

  const ins = await pool.query(
    `INSERT INTO ehr_treatment_plan_templates
       (practice_id, name, description, diagnoses,
        presenting_problem, goals, frequency, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     RETURNING id, name, description, diagnoses, presenting_problem,
               goals, frequency, archived_at, created_at, updated_at`,
    [
      ctx.practiceId,
      name,
      description,
      diagnoses,
      presentingProblem,
      JSON.stringify(goals),
      frequency,
      ctx.user.id,
    ],
  )

  await auditEhrAccess({
    ctx,
    action: 'treatment_plan_template.created',
    resourceType: 'ehr_treatment_plan_template',
    resourceId: ins.rows[0].id,
    details: {
      diagnosis_count: diagnoses.length,
      goal_count: goals.length,
    },
  })

  return NextResponse.json({ template: ins.rows[0] }, { status: 201 })
}
