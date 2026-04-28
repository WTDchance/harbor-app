// app/api/ehr/patients/[id]/documents/[docId]/route.ts
//
// W43 T2 — fetch presigned download URL OR soft-delete a document.
//
// We do NOT proxy the bytes through the Next.js server — that's expensive
// for big PDFs. Instead the API mints a 10-minute presigned GET URL and
// the browser streams directly from S3.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import {
  patientDocumentPresignedGet,
  deletePatientDocument,
} from '@/lib/aws/ehr/patient-documents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; docId: string } },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const action = req.nextUrl.searchParams.get('action') || 'view'
  // 'view' returns the row metadata (audited as viewed).
  // 'download' returns a presigned URL (audited as downloaded).

  const { rows } = await pool.query(
    `SELECT id, s3_key, original_filename, content_type, size_bytes,
            category, description, uploaded_at, deleted_at
       FROM ehr_patient_documents
      WHERE id = $1 AND practice_id = $2 AND patient_id = $3
      LIMIT 1`,
    [params.docId, ctx.practiceId, params.id],
  )
  const doc = rows[0]
  if (!doc || doc.deleted_at) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  if (action === 'download') {
    const url = await patientDocumentPresignedGet(doc.s3_key, 600)
    await auditEhrAccess({
      ctx,
      action: 'patient_document.downloaded',
      resourceType: 'ehr_patient_document',
      resourceId: doc.id,
      details: { size_bytes: doc.size_bytes, content_type: doc.content_type },
    })
    return NextResponse.json({ url, expires_in: 600 })
  }

  await auditEhrAccess({
    ctx,
    action: 'patient_document.viewed',
    resourceType: 'ehr_patient_document',
    resourceId: doc.id,
    details: { size_bytes: doc.size_bytes, content_type: doc.content_type },
  })

  // Strip s3_key from the metadata response — therapist UI doesn't need it.
  const { s3_key, ...meta } = doc
  void s3_key
  return NextResponse.json({ document: meta })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; docId: string } },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT id, s3_key, deleted_at FROM ehr_patient_documents
      WHERE id = $1 AND practice_id = $2 AND patient_id = $3
      LIMIT 1`,
    [params.docId, ctx.practiceId, params.id],
  )
  const doc = rows[0]
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (doc.deleted_at) {
    return NextResponse.json({ error: 'already_deleted' }, { status: 409 })
  }

  // Soft-delete the row, then issue an S3 DELETE which creates a delete
  // marker (the bucket is versioned). The bytes themselves are retained
  // for the lifecycle's noncurrent-version expiration window (~7y).
  await pool.query(
    `UPDATE ehr_patient_documents
        SET deleted_at = NOW(), deleted_by = $1
      WHERE id = $2`,
    [ctx.userId, params.docId],
  )
  try {
    await deletePatientDocument(doc.s3_key)
  } catch (err) {
    // S3 delete failed — the DB row is already marked deleted, so the
    // therapist sees it gone. Log so an operator can run a sweep.
    console.error('[patient_document] s3 delete failed', (err as Error).message)
  }

  await auditEhrAccess({
    ctx,
    action: 'patient_document.deleted',
    resourceType: 'ehr_patient_document',
    resourceId: params.docId,
    details: {},
  })

  return NextResponse.json({ ok: true })
}
