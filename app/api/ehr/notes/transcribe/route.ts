// Harbor EHR — audio-to-text for voice dictation. Uses OpenAI Whisper as a
// fallback for browsers without the Web Speech API (Safari, iPad, Firefox).
//
// Gated behind requireEhrApiSession so only therapists with EHR enabled can
// hit it, and audited so we have a record that voice dictation was used.
//
// Body: multipart/form-data with 'audio' blob
// Response: { transcript: string, demo?: true }

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 25 * 1024 * 1024 // Whisper API limit

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  let formData: FormData
  try { formData = await req.formData() } catch {
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
      { error: `Audio too large (${Math.round(audio.size / 1024 / 1024)}MB). Whisper caps at 25MB.` },
      { status: 413 },
    )
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      transcript:
        '[Demo mode — OPENAI_API_KEY is not set in this environment. Add it to enable Whisper fallback dictation.]',
      demo: true,
    })
  }

  const whisperForm = new FormData()
  whisperForm.append('file', audio, audio.name || 'recording.webm')
  whisperForm.append('model', 'whisper-1')
  whisperForm.append('language', 'en')
  whisperForm.append('response_format', 'json')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: whisperForm,
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('[ehr/transcribe] Whisper API error', res.status, errText)
    return NextResponse.json(
      { error: `Transcription failed (${res.status})` },
      { status: 502 },
    )
  }

  const result = (await res.json()) as { text?: string }
  const transcript = (result.text || '').trim()

  await auditEhrAccess({
    ctx,
    action: 'note.draft.transcribe',
    details: {
      via: 'whisper',
      audio_bytes: audio.size,
      transcript_length: transcript.length,
    },
  })

  return NextResponse.json({ transcript })
}
