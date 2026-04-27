// lib/aws/ehr/superbill-snapshots.ts
//
// Wave 42 — immutable PDF persistence for ehr_superbills.
//
// HIPAA notes:
//   * Bucket is KMS-encrypted at rest with the existing alias/<name>-s3
//     key (terraform: superbill-snapshots-bucket.tf).
//   * 7-year retention via S3 lifecycle (HIPAA 45 CFR 164.530(j)(2)+).
//   * SHA-256 of the persisted PDF is recomputed on every replay and
//     compared to the value stored on ehr_superbills; mismatch fires the
//     billing.superbill.snapshot_integrity_failure audit event and the
//     route 500s rather than serving suspect bytes.
//   * S3 versioning is enabled so admin ?regenerate=true overwrites the
//     same key while preserving the previous version for forensic audit.
//   * Every lifecycle event (created/replayed/regenerated/integrity_failure)
//     writes an audit_logs row.

import { createHash } from 'node:crypto'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'

let _client: S3Client | null = null
function s3(): S3Client {
  if (!_client) _client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' })
  return _client
}

export function superbillSnapshotsBucket(): string {
  return process.env.S3_SUPERBILL_SNAPSHOTS_BUCKET || ''
}

/** Build the canonical key for a superbill snapshot. */
export function superbillKey(args: {
  practiceId: string
  patientId: string
  superbillId: string
}): string {
  return `practice_${args.practiceId}/patient_${args.patientId}/superbill_${args.superbillId}.pdf`
}

export function sha256Hex(bytes: Buffer | Uint8Array): string {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  return createHash('sha256').update(buf).digest('hex')
}

/** Upload PDF bytes to the snapshot bucket; returns key + sha + size. */
export async function putSuperbillSnapshot(args: {
  practiceId: string
  patientId: string
  superbillId: string
  pdf: Buffer | Uint8Array
}): Promise<{ key: string; sha256: string; size: number }> {
  const bucket = superbillSnapshotsBucket()
  if (!bucket) throw new Error('S3_SUPERBILL_SNAPSHOTS_BUCKET not configured')
  const key = superbillKey(args)
  const body = Buffer.isBuffer(args.pdf) ? args.pdf : Buffer.from(args.pdf)
  const sha = sha256Hex(body)
  await s3().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'application/pdf',
    // Store the digest as object metadata for out-of-band verification.
    Metadata: { 'sha256': sha },
  }))
  return { key, sha256: sha, size: body.byteLength }
}

/** Download a snapshot's bytes by key. */
export async function getSuperbillSnapshot(key: string): Promise<Buffer> {
  const bucket = superbillSnapshotsBucket()
  if (!bucket) throw new Error('S3_SUPERBILL_SNAPSHOTS_BUCKET not configured')
  const out = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  // Body is a NodeJS.Readable in lambda/node runtime.
  const body = out.Body as any
  if (!body) throw new Error('s3 GetObject returned empty body')
  if (typeof body.transformToByteArray === 'function') {
    const u8 = await body.transformToByteArray()
    return Buffer.from(u8)
  }
  // Fallback: stream to buffer.
  const chunks: Buffer[] = []
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
