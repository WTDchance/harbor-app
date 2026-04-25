// app/api/ehr/notes/transcribe/route.ts
// Harbor EHR — audio-to-text for voice dictation on browsers that don't
// support the Web Speech API (Safari, iPad, Firefox). Uses OpenAI Whisper.
//
// Gated behind requireEhrAuth so only therapists with EHR enabled can hit it,
// and audited so we have a record that voice dictation was used.
//
// Body: multipart/form-data with 'audio' blob
// Response: { transcript: string }

import { NextRequest, NextResponse } from 'next/server'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

const MAX_BYTES = 25 * 1024 * 1024 // Whisper API limit

export async function POST(req: NextRequest) {
  const auth = await requireEhrAuth()
  if (isAuthError(auth)) return auth

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const audio = formData.get('audio') as File | null
  if (!audio) {
    return NextResponse.json({ error: 'No audio file provided under "audio" field' }, { status: 400 })
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Audio too large (${Math.round(audio.size / 1024 / 1024)}MB). Whisper caps at 25MB.` },
      { status: 413 },
    )
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    // Dev mode: return a clear message so the UI shows something useful.
    return NextResponse.json({
      transcript:
        '[Demo mode — OPENAI_API_KEY is not set in this environment. Add it to .env.ehr to enable Whisper fallback dictation.]',
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
    user: auth.user,
    practiceId: auth.practiceId,
    action: 'note.draft_from_brief', // closest existing action; transcription is dictation for a brief
    details: {
      via: 'whisper',
      audio_bytes: audio.size,
      transcript_length: transcript.length,
    },
  })

  return NextResponse.json({ transcript })
}
