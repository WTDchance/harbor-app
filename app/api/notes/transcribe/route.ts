import { NextRequest, NextResponse } from 'next/server'
import { transcribeAudioFile } from '@/lib/aws/transcribe'

/**
 * POST /api/notes/transcribe
 *
 * Transcribe audio for the lightweight (non-EHR) note flow. Uses AWS
 * Transcribe -- HIPAA-eligible under Harbor's existing AWS BAA. This used
 * to call OpenAI Whisper, which is NOT covered by Harbor's BAAs, so any
 * audio that may have contained PHI was being shipped to a non-BAA
 * processor. Fixed in fix/launch-blockers-from-audit.
 *
 * Body: multipart/form-data with 'audio' blob.
 * Response: { transcript: string, job_id: string, status: 'completed' | 'running' }
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 25 * 1024 * 1024

export async function POST(req: NextRequest) {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const audio = formData.get('audio') as File | null
  if (!audio) {
    return NextResponse.json({ error: 'No audio provided' }, { status: 400 })
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Audio too large (${Math.round(audio.size / 1024 / 1024)}MB). Cap is 25MB.` },
      { status: 413 },
    )
  }

  // No more "[Demo mode]" fallback -- if Transcribe is unconfigured we surface
  // a 503 so callers don't ship a fake transcript into the UI.
  if (!process.env.S3_TRANSCRIBE_UPLOADS_BUCKET) {
    return NextResponse.json(
      {
        error: 'transcription_unavailable',
        detail:
          'AWS Transcribe is not configured (S3_TRANSCRIBE_UPLOADS_BUCKET unset). Voice dictation is disabled until the bucket and IAM role are provisioned.',
      },
      { status: 503 },
    )
  }

  try {
    const buf = Buffer.from(await audio.arrayBuffer())
    const result = await transcribeAudioFile(buf, audio.type || 'audio/webm', 'en-US' as any, {
      filename: audio.name || 'recording.webm',
    })
    return NextResponse.json({
      transcript: result.text,
      job_id: result.jobName,
      status: result.status,
    })
  } catch (err: any) {
    console.error('[notes/transcribe] AWS Transcribe error:', err?.message || err)
    return NextResponse.json(
      { error: err?.message || 'Transcription failed' },
      { status: 502 },
    )
  }
}
