// Harbor EHR — list + create patient consent records (HIPAA NPP, ROI, etc.).
// Drop sign_now=true into POST to atomically capture an in-person signature.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const patientId = req.nextUrl.searchParams.get('patient_id')
  const conds: string[] = ['practice_id = $1']
  const args: unknown[] = [ctx.practiceId]
  if (patientId) { args.push(patientId); conds.push(`patient_id = $${args.length}`) }

  const { rows } = await pool.query(
    `SELECT * FROM ehr_consents
      WHERE ${conds.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT 200`,
    args,
  )

  await auditEhrAccess({
    ctx,
    action: 'consent.list',
    resourceType: 'ehr_consent',
    details: { count: rows.length, patient_id: patientId },
  })
  return NextResponse.json({ consents: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body?.patient_id || !body?.consent_type) {
    return NextResponse.json({ error: 'patient_id and consent_type required' }, { status: 400 })
  }

  const signNow = !!body.sign_now
  const { rows } = await pool.query(
    `INSERT INTO ehr_consents (
       practice_id, patient_id, consent_type, version,
       document_name, document_url,
       roi_party_name, roi_party_role, roi_expires_at, roi_scope,
       status, signed_at, signed_by_name, signed_method, created_by
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6,
       $7, $8, $9, $10,
       $11, $12, $13, $14, $15
     ) RETURNING *`,
    [
      ctx.practiceId, body.patient_id, body.consent_type, body.version || 'v1',
      body.document_name ?? null, body.document_url ?? null,
      body.roi_party_name ?? null, body.roi_party_role ?? null,
      body.roi_expires_at ?? null, body.roi_scope ?? null,
      signNow ? 'signed' : (body.status || 'pending'),
      signNow ? new Date().toISOString() : null,
      signNow ? (body.signed_by_name || 'Patient') : null,
      signNow ? (body.signed_method || 'in_person') : null,
      ctx.user.id,
    ],
  )
  const consent = rows[0]

  await auditEhrAccess({
    ctx,
    action: 'consent.create',
    resourceType: 'ehr_consent',
    resourceId: consent.id,
    details: { consent_type: consent.consent_type, signed: signNow },
  })
  return NextResponse.json({ consent }, { status: 201 })
}
