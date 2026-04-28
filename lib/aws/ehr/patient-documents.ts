// lib/aws/ehr/patient-documents.ts
//
// W43 T2 — S3 helpers for the patient-documents bucket. Mirrors the
// shape of lib/aws/s3.ts but pinned to the dedicated bucket (different
// retention story) and includes a sha256 hash on upload so we can
// detect tampering on a future GET.

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createHash, randomUUID } from 'node:crypto'

let _client: S3Client | null = null

function getClient(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
    })
  }
  return _client
}

export function patientDocumentsBucket(): string {
  return process.env.S3_PATIENT_DOCUMENTS_BUCKET || ''
}

export const PATIENT_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export type StoredDocument = {
  bucket: string
  key: string
  size: number
  sha256: string
}

/**
 * Build the S3 key for a patient document. Layout keeps practice ->
 * patient -> upload-id so listing by prefix works for diagnostics
 * without hitting the DB.
 *
 * Example: 9412.../patient/abc.../doc/xyz/contract.pdf
 */
export function buildDocKey(args: {
  practiceId: string
  patientId: string
  filename: string
}): { key: string; uploadId: string } {
  const uploadId = randomUUID()
  // Normalize filename: strip path separators, cap to 120 chars,
  // collapse whitespace. Preserve extension.
  const safe = args.filename
    .replace(/[\\/]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120) || 'file'
  return {
    key: `${args.practiceId}/${args.patientId}/${uploadId}/${safe}`,
    uploadId,
  }
}

export async function putPatientDocument(args: {
  key: string
  body: Buffer
  contentType: string
}): Promise<StoredDocument> {
  const bucket = patientDocumentsBucket()
  if (!bucket) throw new Error('S3_PATIENT_DOCUMENTS_BUCKET not configured')
  if (args.body.byteLength > PATIENT_DOCUMENT_MAX_BYTES) {
    throw new Error(`document_too_large: ${args.body.byteLength} > ${PATIENT_DOCUMENT_MAX_BYTES}`)
  }
  const sha256 = createHash('sha256').update(args.body).digest('hex')
  await getClient().send(new PutObjectCommand({
    Bucket: bucket,
    Key: args.key,
    Body: args.body,
    ContentType: args.contentType,
  }))
  return { bucket, key: args.key, size: args.body.byteLength, sha256 }
}

export async function patientDocumentPresignedGet(
  key: string,
  ttlSeconds = 600, // 10 min — short window since these are PHI
): Promise<string> {
  const bucket = patientDocumentsBucket()
  if (!bucket) throw new Error('S3_PATIENT_DOCUMENTS_BUCKET not configured')
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: ttlSeconds },
  )
}

export async function deletePatientDocument(key: string): Promise<void> {
  const bucket = patientDocumentsBucket()
  if (!bucket) throw new Error('S3_PATIENT_DOCUMENTS_BUCKET not configured')
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

/** Allow-list of MIME types we accept. Anything else is rejected upfront
 *  to avoid storing executable content patients shouldn't be uploading. */
export const ALLOWED_PATIENT_DOCUMENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'image/tiff',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
