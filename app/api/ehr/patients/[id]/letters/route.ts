// app/api/ehr/patients/[id]/letters/route.ts
//
// Wave 42 / T3 — list letters generated for a patient + create a
// new letter from a template.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { resolveLetterTemplate } from '@/lib/ehr/letter-render'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const { rows } = await pool.query(
    `SELECT l.*,
            COALESCE(g.full_name, g.email) AS generated_by_name,
            COALESCE(s.full_name, s.email) AS signed_by_name
       FROM ehr_letters l
       LEFT JOIN users g ON g.id = l.generated_by
       LEFT JOIN users s ON s.id = l.signed_by
      WHERE l.practice_id = $1 AND l.patient_id = $2
      ORDER BY l.generated_at DESC LIMIT 100`,
    [ctx.practiceId, patientId],
  )
  return NextResponse.json({ letters: rows })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body?.template_id) {
    return NextResponse.json({ error: { code: 'invalid_request', message: 'template_id required' } }, { status: 400 })
  }
  const overrideBody = typeof body.body_md_override === 'string' ? body.body_md_override : null

  // Load template + patient + practice context for placeholder resolution.
  const [tplRes, ptRes, prRes] = await Promise.all([
    pool.query(
      `SELECT * FROM ehr_letter_templates
        WHERE practice_id = $1 AND id = $2 AND is_archived = FALSE LIMIT 1`,
      [ctx.practiceId, body.template_id],
    ),
    pool.query(
      `SELECT first_name, last_name, date_of_birth, pronouns
         FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
      [patientId, ctx.practiceId],
    ),
    pool.query(
      `SELECT name, provider_name FROM practices WHERE id = $1 LIMIT 1`,
      [ctx.practiceId],
    ),
  ])
  const tpl = tplRes.rows[0]
  const pt = ptRes.rows[0]
  if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  if (!pt) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const ctxObj: Record<string, string | null | undefined> = {
    patient_name: [pt.first_name, pt.last_name].filter(Boolean).join(' '),
    patient_first_name: pt.first_name ?? null,
    patient_last_name: pt.last_name ?? null,
    patient_dob: pt.date_of_birth ?? null,
    patient_pronouns: pt.pronouns ?? null,
    practice_name: prRes.rows[0]?.name ?? null,
    therapist_name: prRes.rows[0]?.provider_name ?? null,
    today,
  }

  const resolved = overrideBody ?? resolveLetterTemplate(tpl.body_md_template, ctxObj)

  const { rows } = await pool.query(
    `INSERT INTO ehr_letters
       (patient_id, practice_id, template_id, kind, body_md_resolved, generated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [patientId, ctx.practiceId, tpl.id, tpl.kind, resolved, ctx.user.id],
  )

  await auditEhrAccess({
    ctx,
    action: 'letter.generate',
    resourceType: 'ehr_letter',
    resourceId: rows[0].id,
    details: {
      patient_id: patientId,
      template_id: tpl.id,
      kind: tpl.kind,
      override_used: !!overrideBody,
    },
  })

  return NextResponse.json({ letter: rows[0] }, { status: 201 })
}
