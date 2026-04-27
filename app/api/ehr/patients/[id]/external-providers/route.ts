// app/api/ehr/patients/[id]/external-providers/route.ts
//
// Wave 40 / P3 — per-patient external-provider links.
// GET list (active + inactive) with provider details joined.
// POST link an existing provider to this patient.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROLES = new Set(['pcp','psychiatrist','school','attorney','other'])

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const { rows } = await pool.query(
    `SELECT pep.*,
            ep.name AS provider_name,
            ep.role AS catalogue_role,
            ep.npi, ep.organization, ep.phone, ep.fax, ep.email, ep.address
       FROM ehr_patient_external_providers pep
       JOIN ehr_external_providers ep ON ep.id = pep.external_provider_id
      WHERE pep.practice_id = $1 AND pep.patient_id = $2
      ORDER BY pep.active DESC, pep.role_on_patient ASC, ep.name ASC`,
    [ctx.practiceId, patientId],
  )

  await auditEhrAccess({
    ctx,
    action: 'external_provider.list',
    resourceType: 'ehr_patient_external_provider_list',
    resourceId: patientId,
    details: { count: rows.length, scope: 'patient' },
  })

  return NextResponse.json({ links: rows })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const externalProviderId = typeof body.external_provider_id === 'string' ? body.external_provider_id : ''
  const roleOnPatient = typeof body.role_on_patient === 'string' ? body.role_on_patient : ''
  if (!externalProviderId || !ROLES.has(roleOnPatient)) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: `external_provider_id and role_on_patient (${[...ROLES].join('|')}) required`,
        },
      },
      { status: 400 },
    )
  }
  const notes = typeof body.notes === 'string' ? body.notes : null

  // Verify the provider belongs to this practice and isn't soft-deleted.
  const provCheck = await pool.query(
    `SELECT id FROM ehr_external_providers
      WHERE practice_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
    [ctx.practiceId, externalProviderId],
  )
  if (provCheck.rows.length === 0) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO ehr_patient_external_providers
         (patient_id, practice_id, external_provider_id, role_on_patient, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [patientId, ctx.practiceId, externalProviderId, roleOnPatient, notes],
    )

    await auditEhrAccess({
      ctx,
      action: 'patient.external_provider.link',
      resourceType: 'ehr_patient_external_provider',
      resourceId: rows[0].id,
      details: {
        patient_id: patientId,
        external_provider_id: externalProviderId,
        role_on_patient: roleOnPatient,
      },
    })

    return NextResponse.json({ link: rows[0] }, { status: 201 })
  } catch (err: any) {
    if (err?.code === '23505') {
      return NextResponse.json(
        {
          error: {
            code: 'duplicate',
            message: 'This provider is already linked to this patient with that role.',
          },
        },
        { status: 409 },
      )
    }
    throw err
  }
}
