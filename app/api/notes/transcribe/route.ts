import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/notes/transcribe
 * Transcribe audio using OpenAI Whisper API
 * Body: FormData with 'audio' blob
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const audio = formData.get('audio') as File

    if (!audio) {
      return NextResponse.json(
        { error: 'No audio provided' },
        { status: 400 }
      )
    }

    // If OPENAI_API_KEY is not set, return mock response for dev
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({
        transcript: '[Demo mode] Your transcription would appear here. Add OPENAI_API_KEY to enable voice transcription.',
      })
    }

    // Prepare FormData for Whisper API
    const whisperForm = new FormData()
    whisperForm.append('file', audio, 'recording.webm')
    whisperForm.append('model', 'whisper-1')
    whisperForm.append('language', 'en')

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: whisperForm,
    })

    if (!response.ok) {
      const errorData = await response.text()
      console.error('Whisper API error:', response.status, errorData)
      throw new Error(`Whisper API error: ${response.status}`)
    }

    const result = await response.json()
    return NextResponse.json({ transcript: result.text })
  } catch (error: any) {
    console.error('Transcription error:', error)
    return NextResponse.json(
      { error: error.message || 'Transcription failed' },
      { status: 500 }
    )
  }
}
