// app/api/ehr/patients/[id]/part2-disclosures/route.ts
//
// Wave 41 — list + record a 42 CFR Part 2 disclosure. Every recorded
// disclosure must reference an active (non-revoked, non-expired)
// consent_signatures row.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { PART2_KIND, isPart2SignatureActive } from '@/lib/aws/ehr/part2'

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

  const { rows: pRows } = await pool.query(
    `SELECT id FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [patientId, ctx.practiceId],
  )
  if (!pRows.length) {
    return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
  }

  const { rows } = await pool.query(
    `SELECT id, patient_id, practice_id, consent_signature_id,
            disclosed_to, disclosed_at, what_was_disclosed,
            recipient_acknowledged_redisclosure_prohibition,
            notes, created_by, created_at
       FROM ehr_part2_disclosures
      WHERE patient_id = $1 AND practice_id = $2
      ORDER BY disclosed_at DESC
      LIMIT 200`,
    [patientId, ctx.practiceId],
  )

  await auditEhrAccess({
    ctx,
    action: 'part2_disclosure.list',
    resourceType: 'ehr_part2_disclosure',
    details: { patient_id: patientId, count: rows.length },
  })

  return NextResponse.json({ disclosures: rows })
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
  const consentSignatureId: string = body?.consent_signature_id || ''
  const disclosedTo: string = (body?.disclosed_to || '').trim()
  const whatWasDisclosed: string = (body?.what_was_disclosed || '').trim()
  const ack = !!body?.recipient_acknowledged_redisclosure_prohibition
  const notes: string | null = body?.notes ? String(body.notes) : null

  if (!consentSignatureId || !disclosedTo || !whatWasDisclosed) {
    return NextResponse.json(
      { error: 'consent_signature_id, disclosed_to, what_was_disclosed required' },
      { status: 400 },
    )
  }

  // Confirm signature exists, belongs to this patient + practice, kind
  // is 42_cfr_part2, and the signature is currently active (not revoked,
  // not expired).
  const sigRow = await pool.query(
    `SELECT s.id, s.revoked_at, s.metadata
       FROM consent_signatures s
       JOIN consent_documents d ON d.id = s.document_id
      WHERE s.id = $1
        AND s.patient_id = $2
        AND d.practice_id = $3
        AND d.kind = $4
      LIMIT 1`,
    [consentSignatureId, patientId, ctx.practiceId, PART2_KIND],
  )
  if (!sigRow.rows.length) {
    return NextResponse.json({ error: 'consent_not_found' }, { status: 404 })
  }
  const sig = sigRow.rows[0]
  if (!isPart2SignatureActive({
    revoked_at: sig.revoked_at,
    metadata: sig.metadata,
  })) {
    return NextResponse.json({ error: 'consent_not_active' }, { status: 409 })
  }

  const { rows } = await pool.query(
    `INSERT INTO ehr_part2_disclosures
       (patient_id, practice_id, consent_signature_id, disclosed_to,
        what_was_disclosed, recipient_acknowledged_redisclosure_prohibition,
        notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      patientId,
      ctx.practiceId,
      consentSignatureId,
      disclosedTo,
      whatWasDisclosed,
      ack,
      notes,
      ctx.user.id,
    ],
  )

  await auditEhrAccess({
    ctx,
    action: 'part2_disclosure.create',
    resourceType: 'ehr_part2_disclosure',
    resourceId: rows[0].id,
    details: {
      patient_id: patientId,
      disclosed_to: disclosedTo,
      consent_signature_id: consentSignatureId,
      recipient_acknowledged: ack,
    },
  })

  return NextResponse.json({ disclosure: rows[0] }, { status: 201 })
}
