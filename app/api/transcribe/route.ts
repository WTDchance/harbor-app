// app/api/transcribe/route.ts
//
// Wave 38 M2 — therapist voice notes → AWS Transcribe → Sonnet clean.
//
// HIPAA notes:
//   - Amazon Transcribe is HIPAA-eligible under the existing AWS BAA.
//   - Audio is uploaded to S3 bucket harbor-{env}-transcribe-uploads-{acct}
//     (KMS-encrypted via aws_kms_key.s3, 24h lifecycle to delete originals
//     and any orphan multiparts -- see infra/terraform/transcribe.tf).
//   - Transcript text only lives in the note record (PHI in RDS, encrypted
//     at rest under aws_kms_key.rds).
//   - Every transcribe request writes an audit_logs row with action
//     `note.draft.transcribe` and details {via:'aws_transcribe', patient_id,
//     note_id, job_name}.
//
// Request shape (multipart/form-data):
//   audio:      Blob (audio/webm;codecs=opus or audio/mp4)
//   patient_id: string
//   note_id:    optional string
//
// Response (200):
//   { text: '', job_id: '<job_name>' }   <- job still running, client polls
//   { text: '<final transcript>', job_id }  <- finished within budget
//
// Pollers GET /api/transcribe/<job_id> -- separate route file.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { TranscribeClient, StartTranscriptionJobCommand, GetTranscriptionJobCommand } from '@aws-sdk/client-transcribe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 25 * 1024 * 1024 // 25MB; Transcribe accepts up to 2GB but we cap server load
const POLL_BUDGET_MS = 60_000
const POLL_INTERVAL_MS = 1_500

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

function bucketName(): string {
  const explicit = process.env.S3_TRANSCRIBE_UPLOADS_BUCKET
  if (explicit) return explicit
  // Predictable convention from infra/terraform/transcribe.tf:
  //   harbor-{env}-transcribe-uploads-{accountId}
  // We can't build it without the account id at runtime, so callers MUST
  // set S3_TRANSCRIBE_UPLOADS_BUCKET in ECS task env.
  throw new Error('S3_TRANSCRIBE_UPLOADS_BUCKET is not configured')
}

function pickMediaFormat(filename: string, mime: string): 'webm' | 'mp4' | 'mp3' | 'wav' | 'ogg' | 'flac' {
  const m = mime.toLowerCase()
  if (m.includes('webm')) return 'webm'
  if (m.includes('mp4') || m.includes('m4a')) return 'mp4'
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
  if (m.includes('wav')) return 'wav'
  if (m.includes('ogg')) return 'ogg'
  if (m.includes('flac')) return 'flac'
  // Fall back on extension
  const ext = filename.toLowerCase().split('.').pop()
  if (ext === 'webm' || ext === 'mp4' || ext === 'mp3' || ext === 'wav' || ext === 'ogg' || ext === 'flac') {
    return ext as any
  }
  return 'webm'
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  let formData: FormData
  try { formData = await req.formData() } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const audio = formData.get('audio') as File | null
  const patientId = String(formData.get('patient_id') || '')
  const noteId = String(formData.get('note_id') || '') || null

  if (!audio) {
    return NextResponse.json({ error: 'audio is required' }, { status: 400 })
  }
  if (!patientId) {
    return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Audio too large (${Math.round(audio.size / 1024 / 1024)}MB). Cap is 25MB.` },
      { status: 413 },
    )
  }

  const bucket = bucketName()
  const format = pickMediaFormat(audio.name || '', audio.type || '')
  const ts = Date.now()
  const jobName = `harbor-${ctx.practiceId?.slice(0, 8) || 'np'}-${ts}-${Math.random().toString(36).slice(2, 8)}`
  const key = `audio/${ctx.practiceId || 'no-practice'}/${ts}-${jobName}.${format}`

  // 1) Upload to S3 (KMS encrypted via bucket default)
  const buf = Buffer.from(await audio.arrayBuffer())
  await s3().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buf,
    ContentType: audio.type || 'application/octet-stream',
    Metadata: {
      patient_id: patientId,
      practice_id: ctx.practiceId || '',
      note_id: noteId || '',
      uploaded_by: ctx.user.id,
    },
    ServerSideEncryption: 'aws:kms',
  }))

  // 2) Kick off Transcribe job
  await transcribe().send(new StartTranscriptionJobCommand({
    TranscriptionJobName: jobName,
    Media: { MediaFileUri: `s3://${bucket}/${key}` },
    MediaFormat: format as any,
    LanguageCode: 'en-US',
    Settings: {
      ShowSpeakerLabels: false,
      ChannelIdentification: false,
    },
    OutputBucketName: bucket,
    OutputKey: `transcripts/${jobName}.json`,
  }))

  // 3) Audit
  await auditEhrAccess({
    ctx,
    action: 'note.draft.transcribe',
    resourceType: 'ehr_progress_note',
    resourceId: noteId,
    details: {
      via: 'aws_transcribe',
      patient_id: patientId,
      job_name: jobName,
      audio_bytes: audio.size,
      audio_mime: audio.type || null,
    },
  })

  // 4) Best-effort short poll so quick recordings come back synchronously.
  const start = Date.now()
  while (Date.now() - start < POLL_BUDGET_MS) {
    const r = await transcribe().send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }))
    const status = r.TranscriptionJob?.TranscriptionJobStatus
    if (status === 'COMPLETED') {
      const text = await fetchTranscriptText(r.TranscriptionJob?.Transcript?.TranscriptFileUri || '', bucket, jobName)
      return NextResponse.json({ text, job_id: jobName })
    }
    if (status === 'FAILED') {
      return NextResponse.json({
        error: 'transcription_failed',
        reason: r.TranscriptionJob?.FailureReason || 'unknown',
        job_id: jobName,
      }, { status: 502 })
    }
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS))
  }

  // Still running; client polls.
  return NextResponse.json({ text: '', job_id: jobName })
}

// Fetch + parse Transcribe's JSON output. The default OutputBucketName form
// gives us a presigned-style HTTPS URI; we route via the bucket+key to keep
// things simple inside the VPC.
async function fetchTranscriptText(uri: string, bucket: string, jobName: string): Promise<string> {
  try {
    // Standard output key we set above:
    const cmd = new (await import('@aws-sdk/client-s3')).GetObjectCommand({
      Bucket: bucket,
      Key: `transcripts/${jobName}.json`,
    })
    const out = await s3().send(cmd)
    const body = await out.Body?.transformToString('utf-8')
    if (!body) return ''
    const parsed = JSON.parse(body)
    const txt: string = parsed?.results?.transcripts?.[0]?.transcript || ''
    return String(txt).trim()
  } catch (err) {
    // Fall back to fetching via the URI Transcribe handed us, when bucket access fails.
    if (!uri) return ''
    try {
      const r = await fetch(uri)
      if (!r.ok) return ''
      const j = await r.json()
      return String(j?.results?.transcripts?.[0]?.transcript || '').trim()
    } catch { return '' }
  }
}
