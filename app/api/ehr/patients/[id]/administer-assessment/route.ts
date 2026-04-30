// W52 D2 — start an assessment administration for a patient (portal token mode).
import { NextResponse, type NextRequest } from 'next/server'
import { randomBytes } from 'node:crypto'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const body = await req.json().catch(() => null) as { assessment_slug?: string; via?: string } | null
  if (!body?.assessment_slug) return NextResponse.json({ error: 'slug_required' }, { status: 400 })

  const def = await pool.query(`SELECT slug FROM assessment_definitions WHERE slug = $1`, [body.assessment_slug])
  if (def.rows.length === 0) return NextResponse.json({ error: 'unknown_slug' }, { status: 400 })

  const p = await pool.query(`SELECT 1 FROM patients WHERE id = $1 AND practice_id = $2`, [patientId, ctx.practiceId])
  if (p.rows.length === 0) return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })

  const via = ['portal','sms_link','therapist_session'].includes(body.via ?? '') ? body.via : 'portal'
  const token = 'asm_' + randomBytes(24).toString('base64url')
  const ins = await pool.query(
    `INSERT INTO assessment_administrations
       (practice_id, patient_id, assessment_slug, administered_via, portal_token)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, assessment_slug, status, portal_token, expires_at`,
    [ctx.practiceId, patientId, body.assessment_slug, via, token],
  )

  await auditEhrAccess({
    ctx, action: 'assessment.sent' as any,
    resourceType: 'assessment_administration', resourceId: ins.rows[0].id,
    severity: 'info',
    details: { patient_id: patientId, slug: body.assessment_slug, via },
  })

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  return NextResponse.json({
    administration: ins.rows[0],
    portal_url: `${base}/portal/assessments/${token}`,
  }, { status: 201 })
}
