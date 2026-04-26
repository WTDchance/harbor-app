// Therapist-side intake document template upload — S3 cutover.
//
// Uploads a PDF / PNG / JPEG to the private uploads bucket
// (S3_UPLOADS_BUCKET, terraform: aws_s3_bucket.uploads) and returns a
// presigned GET URL with a 1-hour TTL.
//
// CONTRACT CHANGE from the legacy Supabase Storage path:
//   - Legacy returned a permanent public URL (Supabase storage was
//     configured with a public bucket).
//   - AWS bucket is PRIVATE + KMS-encrypted. The returned `url` is a
//     presigned GET that expires in 1 hour. Callers that store the URL
//     for later display MUST store the `key` instead and re-presign on
//     each render. The dashboard upload widget should treat the returned
//     URL as a one-time preview link.
//
// Object key shape: `intake-documents/<practice_id>/<unix_ms>_<rand>.<ext>`.
//   The legacy `<practice_id>/<…>.<ext>` shape is wrapped in an
//   `intake-documents/` prefix for the AWS bucket since multiple object
//   types share the same bucket.
//
// Auth: requireApiSession (Cognito user). 10MB cap. PDF/PNG/JPEG only.

import { NextResponse, type NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { requireApiSession } from '@/lib/aws/api-auth'
import { putObject, presignedGetUrl, uploadsBucket } from '@/lib/aws/s3'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg']
const MAX_BYTES = 10 * 1024 * 1024
const PRESIGN_TTL_SECONDS = 3600 // 1 hour

export async function POST(req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.practiceId) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

  if (!uploadsBucket()) {
    return NextResponse.json(
      { error: 'S3 uploads bucket not configured (S3_UPLOADS_BUCKET env)' },
      { status: 500 },
    )
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: 'Only PDF, PNG, and JPEG files are allowed' },
      { status: 400 },
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File must be under ${Math.round(MAX_BYTES / 1024 / 1024)}MB` },
      { status: 413 },
    )
  }

  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
  const rand = randomBytes(4).toString('hex')
  const key = `intake-documents/${ctx.practiceId}/${Date.now()}_${rand}.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const body = Buffer.from(arrayBuffer)

  try {
    await putObject({
      key,
      body,
      contentType: file.type,
      cacheControl: 'private, max-age=0, no-cache',
    })
  } catch (err) {
    console.error('[intake/documents/upload] S3 putObject failed:', (err as Error).message)
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })
  }

  let url: string
  try {
    url = await presignedGetUrl(key, PRESIGN_TTL_SECONDS)
  } catch (err) {
    console.error('[intake/documents/upload] presign failed:', (err as Error).message)
    return NextResponse.json({ error: 'Uploaded but failed to mint preview URL' }, { status: 500 })
  }

  await auditEhrAccess({
    ctx,
    action: 'intake.document.upload',
    resourceType: 'intake_document_upload',
    details: {
      key,
      content_type: file.type,
      bytes: file.size,
      original_filename: file.name,
    },
  })

  return NextResponse.json({
    url, // PRESIGNED — expires in 1h. Re-mint via /presign endpoint when needed.
    key, // Persist this if you want to re-presign later.
    bucket: uploadsBucket(),
    fileName: file.name,
    size: file.size,
    contentType: file.type,
    presigned_ttl_seconds: PRESIGN_TTL_SECONDS,
  })
}
