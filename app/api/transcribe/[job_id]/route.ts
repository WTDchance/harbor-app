// app/api/transcribe/[job_id]/route.ts
//
// Wave 38 M2 — polling endpoint for AWS Transcribe jobs.
// Returns { status: 'pending' | 'completed' | 'failed', text?, reason? }.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { TranscribeClient, GetTranscriptionJobCommand } from '@aws-sdk/client-transcribe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

let _s3: S3Client | null = null
function s3() {
  if (!_s3) _s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' })
  return _s3
}

let _transcribe: TranscribeClient | null = null
function transcribe() {
  if (!_transcribe) _transcribe = new TranscribeClient({ region: process.env.AWS_REGION || 'us-east-1' })
  return _transcribe
}

export async function GET(_req: NextRequest, ctxRoute: { params: { job_id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const jobId = ctxRoute.params.job_id
  if (!jobId || !/^harbor-[a-zA-Z0-9-]{1,64}$/.test(jobId)) {
    return NextResponse.json({ error: 'invalid job id' }, { status: 400 })
  }

  let r
  try {
    r = await transcribe().send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobId }))
  } catch (err) {
    return NextResponse.json({ status: 'failed', reason: 'job_not_found' }, { status: 404 })
  }

  const status = r.TranscriptionJob?.TranscriptionJobStatus
  if (status === 'COMPLETED') {
    const bucket = process.env.S3_TRANSCRIBE_UPLOADS_BUCKET || ''
    let text = ''
    try {
      const out = await s3().send(new GetObjectCommand({
        Bucket: bucket,
        Key: `transcripts/${jobId}.json`,
      }))
      const body = await out.Body?.transformToString('utf-8')
      if (body) {
        const parsed = JSON.parse(body)
        text = String(parsed?.results?.transcripts?.[0]?.transcript || '').trim()
      }
    } catch {}
    return NextResponse.json({ status: 'completed', text })
  }
  if (status === 'FAILED') {
    return NextResponse.json({
      status: 'failed',
      reason: r.TranscriptionJob?.FailureReason || 'unknown',
    })
  }
  return NextResponse.json({ status: 'pending' })
}
