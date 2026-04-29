// W49 D3 — update / delete a payer enrollment.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { ENROLLMENT_STATUSES } from '@/lib/ehr/credentialing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; enrollmentId: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: therapistId, enrollmentId } = await params

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const sets: string[] = []
  const args: any[] = []

  for (const k of ['payer_name', 'payer_id', 'npi', 'taxonomy_code', 'notes', 'document_url']) {
    if ((body as any)[k] !== undefined) {
      args.push((body as any)[k] == null ? null : String((body as any)[k]).slice(0, 1000))
      sets.push(`${k} = $${args.length}`)
    }
  }
  for (const k of ['effective_from', 'effective_to']) {
    if ((body as any)[k] !== undefined) {
      args.push((body as any)[k] || null); sets.push(`${k} = $${args.length}`)
    }
  }
  if (body.enrollment_status !== undefined) {
    if (!ENROLLMENT_STATUSES.includes(body.enrollment_status)) return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
    args.push(body.enrollment_status); sets.push(`enrollment_status = $${args.length}`)
  }

  if (sets.length === 0) return NextResponse.json({ error: 'no_changes' }, { status: 400 })
  args.push(enrollmentId, therapistId, ctx.practiceId)

  const upd = await pool.query(
    `UPDATE therapist_payer_enrollments
        SET ${sets.join(', ')}
      WHERE id = $${args.length - 2} AND therapist_id = $${args.length - 1} AND practice_id = $${args.length}
      RETURNING id, payer_name, payer_id, npi, taxonomy_code, enrollment_status,
                effective_from, effective_to, notes, document_url, created_at, updated_at`,
    args,
  )
  if (upd.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx, action: 'credential.payer_enrollment.update',
    resourceType: 'therapist_payer_enrollment', resourceId: enrollmentId,
  })
  return NextResponse.json({ enrollment: upd.rows[0] })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; enrollmentId: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: therapistId, enrollmentId } = await params
  const del = await pool.query(
    `DELETE FROM therapist_payer_enrollments
      WHERE id = $1 AND therapist_id = $2 AND practice_id = $3 RETURNING id`,
    [enrollmentId, therapistId, ctx.practiceId],
  )
  if (del.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await auditEhrAccess({
    ctx, action: 'credential.payer_enrollment.delete',
    resourceType: 'therapist_payer_enrollment', resourceId: enrollmentId,
  })
  return NextResponse.json({ ok: true })
}
