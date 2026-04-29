// W49 D3 — list + create payer enrollments.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { ENROLLMENT_STATUSES } from '@/lib/ehr/credentialing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: therapistId } = await params
  const { rows } = await pool.query(
    `SELECT id, payer_name, payer_id, npi, taxonomy_code, enrollment_status,
            effective_from, effective_to, notes, document_url, created_at, updated_at
       FROM therapist_payer_enrollments
      WHERE practice_id = $1 AND therapist_id = $2
      ORDER BY payer_name ASC`,
    [ctx.practiceId, therapistId],
  )
  return NextResponse.json({ enrollments: rows })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: therapistId } = await params

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const tcheck = await pool.query(`SELECT 1 FROM therapists WHERE id = $1 AND practice_id = $2`, [therapistId, ctx.practiceId])
  if (tcheck.rows.length === 0) return NextResponse.json({ error: 'therapist_not_found' }, { status: 404 })

  const payer = String(body.payer_name ?? '').trim().slice(0, 120)
  if (!payer) return NextResponse.json({ error: 'payer_name_required' }, { status: 400 })
  const status = ENROLLMENT_STATUSES.includes(body.enrollment_status) ? body.enrollment_status : 'pending'
  const npi = body.npi ? String(body.npi).replace(/\D/g, '').slice(0, 10) || null : null

  const ins = await pool.query(
    `INSERT INTO therapist_payer_enrollments
       (practice_id, therapist_id, payer_name, payer_id, npi, taxonomy_code,
        enrollment_status, effective_from, effective_to, notes, document_url, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id, payer_name, payer_id, npi, taxonomy_code, enrollment_status,
               effective_from, effective_to, notes, document_url, created_at, updated_at`,
    [
      ctx.practiceId, therapistId, payer, body.payer_id || null, npi,
      body.taxonomy_code || null, status, body.effective_from || null, body.effective_to || null,
      body.notes || null, body.document_url || null, ctx.user.id,
    ],
  )

  await auditEhrAccess({
    ctx, action: 'credential.payer_enrollment.create',
    resourceType: 'therapist_payer_enrollment', resourceId: ins.rows[0].id,
    details: { therapist_id: therapistId, payer_name: payer, enrollment_status: status },
  })

  return NextResponse.json({ enrollment: ins.rows[0] }, { status: 201 })
}
