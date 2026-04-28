// app/api/ehr/treatment-plan-templates/[id]/clone/route.ts
//
// POST clones a template into a real treatment plan for a patient.
// Body: { patient_id, therapist_id?, status? }
//
// Side effect: if the patient already has an active plan, the existing
// active plan is demoted to 'revised' (mirrors the same invariant the
// /treatment-plans POST route enforces — at most one active plan per
// patient).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body?.patient_id) {
    return NextResponse.json({ error: 'patient_id required' }, { status: 400 })
  }
  const patientId = String(body.patient_id)
  const therapistId = body.therapist_id ? String(body.therapist_id) : null
  const status = body.status === 'draft' ? 'draft' : 'active'

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Load template + verify it belongs to this practice.
    const tplRes = await client.query(
      `SELECT id, name, description, diagnoses, presenting_problem,
              goals, frequency
         FROM ehr_treatment_plan_templates
        WHERE id = $1 AND practice_id = $2 AND archived_at IS NULL
        LIMIT 1`,
      [params.id, ctx.practiceId],
    )
    if (tplRes.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'template_not_found' }, { status: 404 })
    }
    const tpl = tplRes.rows[0]

    // Verify patient.
    const pCheck = await client.query(
      `SELECT id FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
      [patientId, ctx.practiceId],
    )
    if (pCheck.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
    }

    // Demote existing active plan if we're inserting another active one.
    if (status === 'active') {
      await client.query(
        `UPDATE ehr_treatment_plans
            SET status = 'revised'
          WHERE patient_id = $1 AND practice_id = $2 AND status = 'active'`,
        [patientId, ctx.practiceId],
      )
    }

    const ins = await client.query(
      `INSERT INTO ehr_treatment_plans
         (practice_id, patient_id, therapist_id, title,
          presenting_problem, diagnoses, goals, frequency,
          status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
       RETURNING id, patient_id, title, presenting_problem, diagnoses,
                 goals, frequency, status, start_date, review_date,
                 created_at, updated_at`,
      [
        ctx.practiceId,
        patientId,
        therapistId,
        tpl.name,
        tpl.presenting_problem,
        tpl.diagnoses,
        JSON.stringify(tpl.goals || []),
        tpl.frequency,
        status,
        ctx.userId,
      ],
    )

    await client.query('COMMIT')

    await auditEhrAccess({
      ctx,
      action: 'treatment_plan_template.cloned',
      resourceType: 'ehr_treatment_plan',
      resourceId: ins.rows[0].id,
      details: {
        template_id: params.id,
        cloned_status: status,
      },
    })

    return NextResponse.json({ plan: ins.rows[0] }, { status: 201 })
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  } finally {
    client.release()
  }
}
