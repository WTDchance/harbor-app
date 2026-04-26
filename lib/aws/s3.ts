// AWS S3 helpers for Harbor.
//
// Bucket: $S3_UPLOADS_BUCKET (terraform: aws_s3_bucket.uploads). Private,
// KMS-encrypted, versioning enabled, 90-day noncurrent expiration. Task IAM
// already grants GetObject + PutObject + DeleteObject + ListBucket on this
// bucket and its objects.
//
// putObject:           Stream a Buffer/Uint8Array up to S3 with content-type.
// presignedGetUrl:     Mint a time-limited GET URL the browser can fetch.
//                      Default TTL 1 hour — enough for therapist preview;
//                      caller can pass a different ttlSeconds if needed.
//
// All callers should treat the bucket as PRIVATE — there is no
// `getPublicUrl` equivalent. When you need the patient browser to see the
// object, hand back a freshly-minted presigned URL each time.

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

let _client: S3Client | null = null

function getClient(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
    })
  }
  return _client
}

export function uploadsBucket(): string {
  return process.env.S3_UPLOADS_BUCKET || ''
}

export type PutResult = {
  bucket: string
  key: string
  size: number
}

export async function putObject(args: {
  key: string
  body: Buffer | Uint8Array
  contentType: string
  /** Optional cache-control header on the stored object. */
  cacheControl?: string
}): Promise<PutResult> {
  const bucket = uploadsBucket()
  if (!bucket) throw new Error('S3_UPLOADS_BUCKET not configured')
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: args.key,
    Body: args.body,
    ContentType: args.contentType,
    ...(args.cacheControl ? { CacheControl: args.cacheControl } : {}),
  })
  await getClient().send(cmd)
  return { bucket, key: args.key, size: args.body.byteLength }
}

export async function presignedGetUrl(
  key: string,
  ttlSeconds = 3600, // 1h default
): Promise<string> {
  const bucket = uploadsBucket()
  if (!bucket) throw new Error('S3_UPLOADS_BUCKET not configured')
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key })
  return getSignedUrl(getClient(), cmd, { expiresIn: ttlSeconds })
}

export async function deleteObject(key: string): Promise<void> {
  const bucket = uploadsBucket()
  if (!bucket) throw new Error('S3_UPLOADS_BUCKET not configured')
  const cmd = new DeleteObjectCommand({ Bucket: bucket, Key: key })
  await getClient().send(cmd)
}
