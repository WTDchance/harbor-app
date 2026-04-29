// lib/aws/transcribe.ts
//
// AWS Transcribe helper used by /api/transcribe, /api/notes/transcribe, and
// /api/ehr/notes/transcribe.
//
// HIPAA notes:
//   - Amazon Transcribe is HIPAA-eligible under the existing AWS BAA.
//   - Replaces the previous OpenAI Whisper integration, which was NOT
//     covered by Harbor's BAAs and therefore could not legally touch PHI.
//   - Audio is uploaded to the bucket named in S3_TRANSCRIBE_UPLOADS_BUCKET
//     (provisioned by infra/terraform/transcribe.tf, KMS-encrypted, 24h
//     lifecycle to delete originals).
//   - Output JSON is written to the same bucket under transcripts/, then
//     swept by the same lifecycle rule.
//
// Public surface:
//   transcribeAudioFile(buffer, mimeType, languageCode='en-US')
//     - Upload -> start job -> poll up to ~60s -> return text.
//     - Throws if S3_TRANSCRIBE_UPLOADS_BUCKET is unset (caller decides
//       whether to surface as 503).
//   pickMediaFormat(filename, mime)
//     - Shared helper used by the streaming /api/transcribe route.

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  type LanguageCode,
} from '@aws-sdk/client-transcribe'

export type TranscribeMediaFormat = 'webm' | 'mp4' | 'mp3' | 'wav' | 'ogg' | 'flac'

let _s3: S3Client | null = null
function s3(): S3Client {
  if (!_s3) _s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' })
  return _s3
}

let _transcribe: TranscribeClient | null = null
function transcribe(): TranscribeClient {
  if (!_transcribe) {
    _transcribe = new TranscribeClient({ region: process.env.AWS_REGION || 'us-east-1' })
  }
  return _transcribe
}

export function transcribeBucket(): string {
  const explicit = process.env.S3_TRANSCRIBE_UPLOADS_BUCKET
  if (explicit) return explicit
  throw new Error('S3_TRANSCRIBE_UPLOADS_BUCKET is not configured')
}

export function pickMediaFormat(filename: string, mime: string): TranscribeMediaFormat {
  const m = (mime || '').toLowerCase()
  if (m.includes('webm')) return 'webm'
  if (m.includes('mp4') || m.includes('m4a')) return 'mp4'
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
  if (m.includes('wav')) return 'wav'
  if (m.includes('ogg')) return 'ogg'
  if (m.includes('flac')) return 'flac'
  const ext = (filename || '').toLowerCase().split('.').pop()
  if (ext === 'webm' || ext === 'mp4' || ext === 'mp3' || ext === 'wav' || ext === 'ogg' || ext === 'flac') {
    return ext as TranscribeMediaFormat
  }
  return 'webm'
}

export type TranscribeResult = {
  /** Final transcript text (may be empty string if the job took too long). */
  text: string
  /** AWS job name; useful for client polling on a separate route. */
  jobName: string
  /** 'completed' if we got text within budget, otherwise 'running'. */
  status: 'completed' | 'running'
}

const POLL_BUDGET_MS = 60_000
const POLL_INTERVAL_MS = 1_500

/**
 * Synchronously transcribe a short audio clip via AWS Transcribe.
 *
 * Uploads the buffer to S3, kicks off a transcription job, polls until it
 * completes (max ~60s -- most short therapist clips finish in 5-15s) and
 * returns the transcript text.
 *
 * For long-running jobs the function returns `{ text: '', status: 'running',
 * jobName }` so the caller can hand the job name back to the client to poll
 * via /api/transcribe/{jobName}.
 *
 * Throws if S3_TRANSCRIBE_UPLOADS_BUCKET is unset -- callers should turn
 * that into a 503 with a clear message rather than papering over it with a
 * fake transcript.
 */
export async function transcribeAudioFile(
  buffer: Buffer | Uint8Array,
  mimeType: string,
  languageCode: LanguageCode = 'en-US' as LanguageCode,
  opts?: {
    /** Optional filename hint for format detection. */
    filename?: string
    /** Optional metadata stamped on the S3 object for traceability. */
    metadata?: Record<string, string>
    /** Optional override for the practice prefix in the S3 key. */
    practiceId?: string
  },
): Promise<TranscribeResult> {
  const bucket = transcribeBucket()
  const format = pickMediaFormat(opts?.filename || '', mimeType)
  const ts = Date.now()
  const practicePrefix = (opts?.practiceId || 'no-practice').slice(0, 12)
  const jobName = `harbor-${practicePrefix.slice(0, 8) || 'np'}-${ts}-${Math.random().toString(36).slice(2, 8)}`
  const key = `audio/${opts?.practiceId || 'no-practice'}/${ts}-${jobName}.${format}`

  const body = buffer instanceof Buffer ? buffer : Buffer.from(buffer)

  // 1) Upload audio (KMS encrypted via bucket default).
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: mimeType || 'application/octet-stream',
      ServerSideEncryption: 'aws:kms',
      Metadata: opts?.metadata,
    }),
  )

  // 2) Start the transcription job.
  await transcribe().send(
    new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      Media: { MediaFileUri: `s3://${bucket}/${key}` },
      MediaFormat: format,
      LanguageCode: languageCode,
      Settings: { ShowSpeakerLabels: false, ChannelIdentification: false },
      OutputBucketName: bucket,
      OutputKey: `transcripts/${jobName}.json`,
    }),
  )

  // 3) Poll until done or budget elapses.
  const start = Date.now()
  while (Date.now() - start < POLL_BUDGET_MS) {
    const r = await transcribe().send(
      new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }),
    )
    const status = r.TranscriptionJob?.TranscriptionJobStatus
    if (status === 'COMPLETED') {
      const text = await fetchTranscriptText(
        r.TranscriptionJob?.Transcript?.TranscriptFileUri || '',
        bucket,
        jobName,
      )
      return { text, jobName, status: 'completed' }
    }
    if (status === 'FAILED') {
      const reason = r.TranscriptionJob?.FailureReason || 'unknown'
      throw new Error(`Transcribe job failed: ${reason}`)
    }
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS))
  }

  // Job still running; caller can poll on /api/transcribe/{jobName}.
  return { text: '', jobName, status: 'running' }
}

/** Pull the final transcript text out of Transcribe's JSON output. */
export async function fetchTranscriptText(
  uri: string,
  bucket: string,
  jobName: string,
): Promise<string> {
  try {
    const out = await s3().send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: `transcripts/${jobName}.json`,
      }),
    )
    const body = await out.Body?.transformToString('utf-8')
    if (!body) return ''
    const parsed = JSON.parse(body)
    const txt: string = parsed?.results?.transcripts?.[0]?.transcript || ''
    return String(txt).trim()
  } catch {
    if (!uri) return ''
    try {
      const r = await fetch(uri)
      if (!r.ok) return ''
      const j = await r.json()
      return String((j as any)?.results?.transcripts?.[0]?.transcript || '').trim()
    } catch {
      return ''
    }
  }
}
