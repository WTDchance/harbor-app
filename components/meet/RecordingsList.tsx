'use client'

// Wave 43 / T0 — recording playback list shown on /meet/[appointment_id].
// Reads the W42 T5 recordings list, gates each row on status='available',
// generates a presigned playback URL on click and renders an inline
// HTMLVideoElement.

import { useEffect, useState } from 'react'
import { Video, Play, Loader2, AlertCircle } from 'lucide-react'

interface Recording {
  id: string
  status: 'starting' | 'recording' | 'stopping' | 'available' | 'deleted' | 'error'
  started_at: string
  stopped_at: string | null
  duration_seconds: number | null
  error_reason: string | null
}

export function RecordingsList({ appointmentId }: { appointmentId: string }) {
  const [list, setList] = useState<Recording[]>([])
  const [loading, setLoading] = useState(true)
  const [activeUrl, setActiveUrl] = useState<{ id: string; url: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/ehr/appointments/${appointmentId}/telehealth/recording`, { credentials: 'include' })
      if (!res.ok) { setList([]); return }
      const data = await res.json()
      setList(Array.isArray(data?.recordings) ? data.recordings : [])
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [appointmentId])

  async function play(rec: Recording) {
    setBusyId(rec.id); setError(null)
    try {
      const res = await fetch(
        `/api/ehr/appointments/${appointmentId}/telehealth/recording/${rec.id}/playback`,
        { credentials: 'include' },
      )
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error?.message || `Couldn't load recording (${res.status})`)
        return
      }
      setActiveUrl({ id: rec.id, url: data.url })
    } finally { setBusyId(null) }
  }

  if (loading) return <div className="text-xs text-gray-500"><Loader2 className="w-3 h-3 inline animate-spin mr-1" />Loading recordings…</div>
  if (list.length === 0) return null

  return (
    <div className="bg-white/10 rounded-xl p-3 mt-4">
      <div className="flex items-center gap-2 mb-2">
        <Video className="w-4 h-4 text-white/80" />
        <span className="text-sm font-semibold text-white">Recordings</span>
      </div>
      {error && (
        <div className="mb-2 p-2 rounded bg-red-500/20 text-xs text-white flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{error}
        </div>
      )}
      <ul className="space-y-1.5">
        {list.map((r) => {
          const startedDt = new Date(r.started_at)
          const dur = r.duration_seconds ? `${Math.round(r.duration_seconds / 60)} min` : '—'
          const playable = r.status === 'available'
          return (
            <li key={r.id} className="bg-black/30 rounded-lg p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm text-white">
                    {startedDt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                  <div className="text-xs text-white/60">
                    {dur} · status: {r.status}
                    {r.error_reason && <span className="text-red-300"> · {r.error_reason}</span>}
                  </div>
                </div>
                {playable && (
                  <button onClick={() => play(r)} disabled={busyId === r.id}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-md disabled:opacity-60"
                    style={{ minHeight: 36 }}>
                    {busyId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                    {busyId === r.id ? 'Loading' : 'Play'}
                  </button>
                )}
              </div>
              {activeUrl?.id === r.id && (
                <div className="mt-2">
                  <video controls src={activeUrl.url} className="w-full rounded-md" />
                  <p className="text-[10px] text-white/40 mt-1">Playback URL expires in 1h.</p>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
