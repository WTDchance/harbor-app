// W52 D2 — Retell tool: start an in-call assessment (PHQ-2 / GAD-2 only).
//
// HMAC verification belongs at the Retell webhook layer; here we treat
// the body as signed-in tool input. Returns the question list so Ellie
// can read each one and pass responses back.
import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { writeAuditLog } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface StartArgs {
  practice_id: string
  call_id: string
  patient_id?: string | null
  lead_id?: string | null
  assessment_slug: 'phq-2' | 'gad-2'
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as StartArgs | null
  if (!body?.practice_id || !body.assessment_slug || !body.call_id) {
    return NextResponse.json({ error: 'missing_required' }, { status: 400 })
  }

  const def = await pool.query(
    `SELECT slug, name, questions, scoring_rules, call_administrable
       FROM assessment_definitions WHERE slug = $1`,
    [body.assessment_slug],
  )
  if (def.rows.length === 0) return NextResponse.json({ error: 'unknown_slug' }, { status: 400 })
  if (!def.rows[0].call_administrable) return NextResponse.json({ error: 'not_call_administrable' }, { status: 400 })

  const ins = await pool.query(
    `INSERT INTO assessment_administrations
       (practice_id, patient_id, lead_id, assessment_slug, administered_via, call_id, status, started_at)
     VALUES ($1, $2, $3, $4, 'receptionist_call', $5, 'in_progress', NOW())
     RETURNING id`,
    [body.practice_id, body.patient_id ?? null, body.lead_id ?? null, body.assessment_slug, body.call_id],
  )

  await writeAuditLog({
    practice_id: body.practice_id,
    action: 'assessment.administered_in_call',
    resource_type: 'assessment_administration',
    resource_id: ins.rows[0].id,
    severity: 'info',
    details: { slug: body.assessment_slug, call_id: body.call_id },
  })

  return NextResponse.json({
    administration_id: ins.rows[0].id,
    questions: def.rows[0].questions,
    scoring_rules: def.rows[0].scoring_rules,
  })
}
