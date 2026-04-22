// components/ehr/VoiceRecorder.tsx
// Browser-native speech-to-text via the Web Speech API (SpeechRecognition).
// Pros: no API key, free, works offline in Chrome/Edge, streams tokens live.
// Cons: Chromium-only, quality varies. Therapist edits the result anyway.
// Gracefully hides itself if the browser doesn't support it.

'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, StopCircle } from 'lucide-react'

type Props = {
  onAppend: (chunk: string) => void
  disabled?: boolean
  label?: string
}

// Minimal shape for the Web Speech API (not in TS lib.dom by default).
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

export function VoiceRecorder({ onAppend, disabled, label = 'Dictate' }: Props) {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const lastResultIndexRef = useRef(0)

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null)
  }, [])

  function start() {
    if (disabled) return
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      setError('Voice dictation is not available in this browser. Try Chrome.')
      return
    }
    try {
      const rec = new Ctor()
      rec.continuous = true
      rec.interimResults = false
      rec.lang = 'en-US'
      lastResultIndexRef.current = 0

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
          ? 'Microphone permission denied. Click the lock icon in the address bar to allow mic access.'
          : ev?.error === 'no-speech'
          ? null // don't show scary errors for pause
          : `Voice error: ${ev?.error || 'unknown'}`
        if (msg) setError(msg)
      }
      rec.onend = () => {
        setRecording(false)
      }
      rec.start()
      recRef.current = rec
      setRecording(true)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start recording')
      setRecording(false)
    }
  }

  function stop() {
    try { recRef.current?.stop() } catch {}
    recRef.current = null
    setRecording(false)
  }

  // Tear down on unmount so a stray recognizer doesn't keep the mic open.
  useEffect(() => () => { try { recRef.current?.stop() } catch {} }, [])

  if (supported === false) return null // no-op in unsupported browsers

  return (
    <div className="flex flex-col items-end gap-1">
      {!recording ? (
        <button
          type="button"
          onClick={start}
          disabled={disabled || supported === null}
          className="inline-flex items-center gap-1.5 text-xs bg-white border border-gray-300 text-gray-700 px-2.5 py-1.5 rounded-md hover:bg-gray-50 disabled:opacity-50"
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
      {error && <div className="text-[10px] text-red-600 max-w-[220px] text-right">{error}</div>}
    </div>
  )
}
