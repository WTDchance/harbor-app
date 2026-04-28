// app/api/ehr/patients/[id]/documents/route.ts
//
// W43 T2 — list + upload patient documents for a single patient.
//
// Upload uses multipart/form-data (no presigned PUT) so we can:
//   * cap size server-side (10 MB)
//   * verify content-type against the allow-list
//   * compute and store the SHA-256 in the DB row
//   * write the audit row before responding

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import {
  buildDocKey,
  putPatientDocument,
  ALLOWED_PATIENT_DOCUMENT_TYPES,
  PATIENT_DOCUMENT_MAX_BYTES,
} from '@/lib/aws/ehr/patient-documents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const patientId = params.id

  // Confirm the patient is in this practice.
  const pCheck = await pool.query(
    `SELECT id FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [patientId, ctx.practiceId],
  )
  if (pCheck.rows.length === 0) {
    return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
  }

  const { rows } = await pool.query(
    `SELECT id, original_filename, content_type, size_bytes, category,
            description, uploaded_by_patient, uploaded_at
       FROM ehr_patient_documents
      WHERE practice_id = $1 AND patient_id = $2 AND deleted_at IS NULL
      ORDER BY uploaded_at DESC`,
    [ctx.practiceId, patientId],
  )

  return NextResponse.json({ documents: rows })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const patientId = params.id

  const pCheck = await pool.query(
    `SELECT id FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [patientId, ctx.practiceId],
  )
  if (pCheck.rows.length === 0) {
    return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'empty_file' }, { status: 400 })
  }
  if (file.size > PATIENT_DOCUMENT_MAX_BYTES) {
    return NextResponse.json(
      { error: `file_too_large (max ${PATIENT_DOCUMENT_MAX_BYTES} bytes)` },
      { status: 413 },
    )
  }

  const contentType = file.type || 'application/octet-stream'
  if (!ALLOWED_PATIENT_DOCUMENT_TYPES.has(contentType)) {
    return NextResponse.json(
      { error: `content_type_not_allowed: ${contentType}` },
      { status: 415 },
    )
  }

  const category = String(formData.get('category') || 'other').slice(0, 64)
  const description = formData.get('description')
    ? String(formData.get('description')).slice(0, 500)
    : null

  const arrayBuffer = await file.arrayBuffer()
  const buf = Buffer.from(arrayBuffer)

  const { key } = buildDocKey({
    practiceId: ctx.practiceId,
    patientId,
    filename: file.name || 'upload',
  })

  let stored
  try {
    stored = await putPatientDocument({
      key,
      body: buf,
      contentType,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }

  const ins = await pool.query(
    `INSERT INTO ehr_patient_documents
       (practice_id, patient_id, s3_key, original_filename, content_type,
        size_bytes, sha256_hex, category, description, uploaded_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, original_filename, content_type, size_bytes, category,
               description, uploaded_by_patient, uploaded_at`,
    [
      ctx.practiceId,
      patientId,
      stored.key,
      file.name || 'upload',
      contentType,
      stored.size,
      stored.sha256,
      category,
      description,
      ctx.userId,
    ],
  )

  await auditEhrAccess({
    ctx,
    action: 'patient_document.uploaded',
    resourceType: 'ehr_patient_document',
    resourceId: ins.rows[0].id,
    details: {
      size_bytes: stored.size,
      content_type: contentType,
      category,
    },
  })

  return NextResponse.json({ document: ins.rows[0] }, { status: 201 })
}
