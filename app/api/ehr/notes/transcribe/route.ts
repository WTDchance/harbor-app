// Harbor EHR -- audio-to-text for voice dictation.
//
// Now uses AWS Transcribe (HIPAA-eligible under Harbor's existing AWS BAA).
// Previously called OpenAI Whisper, which was NOT covered by Harbor's BAAs
// and therefore could not legally process therapist-recorded audio that may
// contain PHI. Fixed in fix/launch-blockers-from-audit.
//
// Gated behind requireEhrApiSession so only therapists with EHR enabled can
// hit it, and audited so we have a record that voice dictation was used.
//
// Body: multipart/form-data with 'audio' blob
// Response: { transcript: string, job_id: string, status: 'completed' | 'running' }

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { transcribeAudioFile } from '@/lib/aws/transcribe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 25 * 1024 * 1024

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const audio = formData.get('audio') as File | null
  if (!audio) {
    return NextResponse.json(
      { error: 'No audio file provided under "audio" field' },
      { status: 400 },
    )
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Audio too large (${Math.round(audio.size / 1024 / 1024)}MB). Cap is 25MB.` },
      { status: 413 },
    )
  }

  // No more demo-mode fake transcript -- if Transcribe is unconfigured we
  // return an honest 503.
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
      practiceId: ctx.practiceId || undefined,
      metadata: {
        practice_id: ctx.practiceId || '',
        uploaded_by: ctx.user.id,
      },
    })

    await auditEhrAccess({
      ctx,
      action: 'note.draft.transcribe',
      details: {
        via: 'aws_transcribe',
        audio_bytes: audio.size,
        transcript_length: result.text.length,
        job_name: result.jobName,
        status: result.status,
      },
      severity: 'info',
    })

    return NextResponse.json({
      transcript: result.text,
      job_id: result.jobName,
      status: result.status,
    })
  } catch (err: any) {
    console.error('[ehr/transcribe] AWS Transcribe error:', err?.message || err)
    return NextResponse.json(
      { error: err?.message || 'Transcription failed' },
      { status: 502 },
    )
  }
}
