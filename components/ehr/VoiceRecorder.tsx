// components/ehr/VoiceRecorder.tsx
// Two transcription paths, chosen automatically per browser:
//   - Chrome / Edge / Brave / Arc: browser-native Web Speech API.
//     Free, streaming, works offline. No server round-trip.
//   - Safari / iPad / Firefox: record audio via MediaRecorder, POST to
//     /api/ehr/notes/transcribe which calls OpenAI Whisper.
//
// Either way the therapist hits Dictate, talks, hits Stop; whatever text
// we get back gets appended to the host field (a brief textarea).

'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, StopCircle, Loader2 } from 'lucide-react'

type Props = {
  onAppend: (chunk: string) => void
  disabled?: boolean
  label?: string
}

// ---------------------------------------------------------------------------
// Web Speech API shape (not in lib.dom by default)
// ---------------------------------------------------------------------------
type SpeechRecognitionEventLike = {
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean; length: number }> & { length: number }
  resultIndex: number
}
type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((e: any) => void) | null
}

function getRecognitionCtor(): { new (): SpeechRecognitionLike } | null {
  if (typeof window === 'undefined') return null
  const w = window as any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

function hasMediaRecorder(): boolean {
  return typeof window !== 'undefined' &&
         typeof (window as any).MediaRecorder !== 'undefined' &&
         !!navigator.mediaDevices?.getUserMedia
}

type Mode = 'native' | 'whisper' | 'unsupported' | 'unknown'

export function VoiceRecorder({ onAppend, disabled, label = 'Dictate' }: Props) {
  const [mode, setMode] = useState<Mode>('unknown')
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Native path state
  const recRef = useRef<SpeechRecognitionLike | null>(null)

  // Whisper path state
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    if (getRecognitionCtor()) setMode('native')
    else if (hasMediaRecorder()) setMode('whisper')
    else setMode('unsupported')
  }, [])

  // Cleanup on unmount
  useEffect(() => () => {
    try { recRef.current?.stop() } catch {}
    try { mediaRef.current?.stop() } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }, [])

  // --------- Native path: Web Speech API ----------
  function startNative() {
    const Ctor = getRecognitionCtor()
    if (!Ctor) return
    try {
      const rec = new Ctor()
      rec.continuous = true
      rec.interimResults = false
      rec.lang = 'en-US'
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal && r[0]?.transcript) {
            const chunk = r[0].transcript.trim()
            if (chunk) onAppend(chunk)
          }
        }
      }
      rec.onerror = (ev: any) => {
        const msg = ev?.error === 'not-allowed'
          ? 'Microphone permission denied. Allow mic in the browser address bar.'
          : ev?.error === 'no-speech'
          ? null
          : `Voice error: ${ev?.error || 'unknown'}`
        if (msg) setError(msg)
      }
      rec.onend = () => setRecording(false)
      rec.start()
      recRef.current = rec
      setRecording(true)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start recording')
      setRecording(false)
    }
  }

  function stopNative() {
    try { recRef.current?.stop() } catch {}
    recRef.current = null
    setRecording(false)
  }

  // --------- Whisper path: MediaRecorder -> /api/ehr/notes/transcribe ----------
  async function startWhisper() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = pickMime()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        // Release mic immediately
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        await sendToWhisper(chunksRef.current, mime || 'audio/webm')
      }
      rec.start()
      mediaRef.current = rec
      setRecording(true)
      setError(null)
    } catch (err: any) {
      const msg = err?.name === 'NotAllowedError'
        ? 'Microphone permission denied. Allow mic access to dictate.'
        : err?.name === 'NotFoundError'
        ? 'No microphone found on this device.'
        : `Failed to start: ${err?.message || err}`
      setError(msg)
      setRecording(false)
    }
  }

  function stopWhisper() {
    try { mediaRef.current?.stop() } catch {}
    mediaRef.current = null
    setRecording(false)
  }

  async function sendToWhisper(chunks: Blob[], mime: string) {
    if (!chunks.length) return
    setTranscribing(true)
    try {
      const blob = new Blob(chunks, { type: mime })
      const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm'
      const form = new FormData()
      form.append('audio', blob, `recording.${ext}`)
      const res = await fetch('/api/ehr/notes/transcribe', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Transcription failed')
      const text = (json.transcript || '').trim()
      if (text) onAppend(text)
      if (json.demo) setError(json.transcript)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transcription failed')
    } finally {
      setTranscribing(false)
    }
  }

  function pickMime(): string | null {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
      'audio/ogg',
    ]
    for (const m of candidates) {
      if (typeof (window as any).MediaRecorder?.isTypeSupported === 'function' &&
          (window as any).MediaRecorder.isTypeSupported(m)) return m
    }
    return null
  }

  function start() {
    if (disabled) return
    setError(null)
    if (mode === 'native') return startNative()
    if (mode === 'whisper') return startWhisper()
  }

  function stop() {
    if (mode === 'native') return stopNative()
    if (mode === 'whisper') return stopWhisper()
  }

  if (mode === 'unsupported' || mode === 'unknown') return null

  return (
    <div className="flex flex-col items-end gap-1">
      {transcribing ? (
        <div className="inline-flex items-center gap-1.5 text-xs bg-white border border-gray-300 text-gray-700 px-2.5 py-1.5 rounded-md">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Transcribing…
        </div>
      ) : !recording ? (
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 text-xs bg-white border border-gray-300 text-gray-700 px-2.5 py-1.5 rounded-md hover:bg-gray-50 disabled:opacity-50"
          title={mode === 'native' ? 'Browser speech recognition' : 'Whisper transcription (Safari/iPad)'}
        >
          <Mic className="w-3.5 h-3.5" />
          {label}
        </button>
      ) : (
        <button
          type="button"
          onClick={stop}
          className="inline-flex items-center gap-1.5 text-xs bg-red-600 text-white px-2.5 py-1.5 rounded-md hover:bg-red-700 animate-pulse"
        >
          <StopCircle className="w-3.5 h-3.5" />
          Stop
        </button>
      )}
      {error && <div className="text-[10px] text-red-600 max-w-[240px] text-right">{error}</div>}
    </div>
  )
}
