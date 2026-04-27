// app/api/ehr/patients/[id]/external-providers/[linkId]/route.ts
//
// Wave 40 / P3 — unlink an external provider from a patient.
// PATCH to flip active flag; DELETE to remove the row.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId, linkId } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const sets: string[] = []
  const args: unknown[] = []
  if (typeof body.active === 'boolean') {
    args.push(body.active); sets.push(`active = $${args.length}`)
  }
  if ('notes' in body) {
    args.push(body.notes == null ? null : String(body.notes))
    sets.push(`notes = $${args.length}`)
  }
  if (sets.length === 0) return NextResponse.json({ error: 'no fields to update' }, { status: 400 })

  args.push(ctx.practiceId, patientId, linkId)
  const { rows } = await pool.query(
    `UPDATE ehr_patient_external_providers
        SET ${sets.join(', ')}
      WHERE practice_id = $${args.length - 2}
        AND patient_id  = $${args.length - 1}
        AND id          = $${args.length}
      RETURNING *`,
    args,
  )
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    // Active-flag flip is conceptually unlink/relink; emit the right action.
    action: typeof body.active === 'boolean' && body.active === false
      ? 'patient.external_provider.unlink'
      : 'patient.external_provider.link',
    resourceType: 'ehr_patient_external_provider',
    resourceId: linkId,
    details: { patient_id: patientId, fields_changed: sets.map((s) => s.split(' ')[0]) },
  })

  return NextResponse.json({ link: rows[0] })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId, linkId } = await params

  const { rows } = await pool.query(
    `DELETE FROM ehr_patient_external_providers
      WHERE practice_id = $1 AND patient_id = $2 AND id = $3
      RETURNING id, external_provider_id, role_on_patient`,
    [ctx.practiceId, patientId, linkId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'patient.external_provider.unlink',
    resourceType: 'ehr_patient_external_provider',
    resourceId: linkId,
    details: {
      patient_id: patientId,
      external_provider_id: rows[0].external_provider_id,
      role_on_patient: rows[0].role_on_patient,
    },
  })

  return NextResponse.json({ unlinked: true })
}
