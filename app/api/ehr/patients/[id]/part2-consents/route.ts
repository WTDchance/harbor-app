// app/api/ehr/patients/[id]/part2-consents/route.ts
//
// Wave 41 — list + create 42 CFR Part 2 consents for one patient.
// A "Part 2 consent" is one consent_documents row (kind='42_cfr_part2')
// + one consent_signatures row whose metadata carries the structured
// statutory fields (recipient, purpose, expiration, etc.).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import {
  PART2_KIND,
  PART2_BODY_MD_TEMPLATE,
  PART2_REDISCLOSURE_NOTICE,
  PART2_REVOCATION_RIGHT_BOILERPLATE,
  validatePart2Metadata,
  isPart2SignatureActive,
} from '@/lib/aws/ehr/part2'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) {
    return NextResponse.json({ error: 'practice_required' }, { status: 403 })
  }
  const { id: patientId } = await params

  // Confirm patient is in this practice (404 otherwise — never confirm
  // cross-practice patient existence).
  const { rows: pRows } = await pool.query(
    `SELECT id FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [patientId, ctx.practiceId],
  )
  if (!pRows.length) {
    return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
  }

  const { rows } = await pool.query(
    `SELECT s.id, s.document_id, s.patient_id, s.signed_at, s.signed_name,
            s.metadata, s.revoked_at, s.revoked_by,
            d.kind, d.version, d.body_md
       FROM consent_signatures s
       JOIN consent_documents d ON d.id = s.document_id
      WHERE s.patient_id = $1
        AND d.practice_id = $2
        AND d.kind = $3
      ORDER BY s.signed_at DESC`,
    [patientId, ctx.practiceId, PART2_KIND],
  )

  const items = rows.map((r) => ({
    ...r,
    is_active: isPart2SignatureActive({
      revoked_at: r.revoked_at,
      metadata: r.metadata,
    }),
  }))

  await auditEhrAccess({
    ctx,
    action: 'part2_consent.list',
    resourceType: 'consent_signature',
    details: { patient_id: patientId, count: items.length },
  })

  return NextResponse.json({ consents: items })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) {
    return NextResponse.json({ error: 'practice_required' }, { status: 403 })
  }
  const { id: patientId } = await params

  const { rows: pRows } = await pool.query(
    `SELECT id FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [patientId, ctx.practiceId],
  )
  if (!pRows.length) {
    return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
  }

  const body = await req.json().catch(() => null) as any
  const rawMeta = body?.metadata && typeof body.metadata === 'object' ? body.metadata : null
  const signedName: string | null = body?.signed_name || null
  const signatureDataUrl: string = body?.signature_data_url || ''
  if (!signatureDataUrl) {
    return NextResponse.json({ error: 'signature_data_url_required' }, { status: 400 })
  }

  // Fill in boilerplate if the API caller didn't pass it explicitly so
  // the metadata validator passes regardless.
  const metadata = {
    kind: PART2_KIND,
    statement_of_revocation_right: PART2_REVOCATION_RIGHT_BOILERPLATE,
    prohibition_on_redisclosure_notice: PART2_REDISCLOSURE_NOTICE,
    ...(rawMeta || {}),
  }

  const errors = validatePart2Metadata(metadata)
  if (errors.length) {
    return NextResponse.json({ error: 'invalid_metadata', errors }, { status: 400 })
  }

  // Find or create the practice's active 42_cfr_part2 consent_documents
  // row. We want one document template per practice; signatures vary
  // per-recipient via metadata.
  const docVersion: string = body?.version || 'v1'
  const docBodyMd: string = body?.body_md || PART2_BODY_MD_TEMPLATE
  let documentId: string
  const docRow = await pool.query(
    `SELECT id FROM consent_documents
      WHERE practice_id = $1 AND kind = $2 AND version = $3
      ORDER BY effective_at DESC LIMIT 1`,
    [ctx.practiceId, PART2_KIND, docVersion],
  )
  if (docRow.rows.length) {
    documentId = docRow.rows[0].id
  } else {
    const ins = await pool.query(
      `INSERT INTO consent_documents (practice_id, kind, version, body_md, required)
       VALUES ($1, $2, $3, $4, FALSE) RETURNING id`,
      [ctx.practiceId, PART2_KIND, docVersion, docBodyMd],
    )
    documentId = ins.rows[0].id
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const userAgent = req.headers.get('user-agent') || null

  const { rows } = await pool.query(
    `INSERT INTO consent_signatures
       (document_id, patient_id, signature_data_url, signed_name, ip, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING *`,
    [documentId, patientId, signatureDataUrl, signedName, ip, userAgent, JSON.stringify(metadata)],
  )

  await auditEhrAccess({
    ctx,
    action: 'part2_consent.create',
    resourceType: 'consent_signature',
    resourceId: rows[0].id,
    details: {
      patient_id: patientId,
      recipient_name: metadata.recipient_name,
      purpose_of_disclosure: metadata.purpose_of_disclosure,
    },
  })

  return NextResponse.json({ consent: rows[0] }, { status: 201 })
}
