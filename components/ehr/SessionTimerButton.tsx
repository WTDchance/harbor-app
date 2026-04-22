// components/ehr/SessionTimerButton.tsx
// In-line session timer on each appointment row:
//   - "Start" button stamps actual_started_at
//   - Running: shows elapsed clock + red "Stop" button
//   - After stop: shows "Xm" total duration; double-click the number to reset
// Lightweight — no global state, each appointment row is independent.

'use client'

import { useEffect, useRef, useState } from 'react'
import { Play, Square, Timer } from 'lucide-react'

export function SessionTimerButton({ appointmentId }: { appointmentId: string }) {
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const [endedAt, setEndedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nowTick, setNowTick] = useState(Date.now())
  const tickRef = useRef<number | null>(null)

  // Load initial state
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/ehr/appointments/${appointmentId}/session`)
        if (res.ok) {
          const j = await res.json()
          setStartedAt(j.started_at); setEndedAt(j.ended_at)
        }
      } finally { setLoading(false) }
    })()
  }, [appointmentId])

  // Tick when running
  useEffect(() => {
    if (startedAt && !endedAt) {
      tickRef.current = window.setInterval(() => setNowTick(Date.now()), 1000) as any
      return () => { if (tickRef.current) window.clearInterval(tickRef.current) }
    }
  }, [startedAt, endedAt])

  async function act(action: 'start' | 'stop' | 'reset') {
    const res = await fetch(`/api/ehr/appointments/${appointmentId}/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (!res.ok) { alert((await res.json()).error || 'Timer action failed'); return }
    const j = await res.json()
    setStartedAt(j.started_at); setEndedAt(j.ended_at)
  }

  if (loading) return null

  // Not started
  if (!startedAt) {
    return (
      <button
        type="button"
        onClick={() => act('start')}
        title="Start session timer"
        className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-900 font-medium"
      >
        <Play className="w-3 h-3 fill-current" />
        Start
      </button>
    )
  }

  // Running
  if (startedAt && !endedAt) {
    const ms = nowTick - new Date(startedAt).getTime()
    return (
      <div className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-mono text-gray-900">
          <Timer className="w-3 h-3 text-emerald-600 animate-pulse" />
          {formatElapsed(ms)}
        </span>
        <button
          type="button"
          onClick={() => act('stop')}
          className="inline-flex items-center gap-1 text-xs text-red-700 hover:text-red-900 font-medium"
        >
          <Square className="w-3 h-3 fill-current" />
          Stop
        </button>
      </div>
    )
  }

  // Ended — show total duration
  const duration = new Date(endedAt!).getTime() - new Date(startedAt).getTime()
  return (
    <button
      type="button"
      onDoubleClick={() => act('reset')}
      title="Actual session duration. Double-click to reset."
      className="inline-flex items-center gap-1 text-xs text-gray-600 font-mono"
    >
      <Timer className="w-3 h-3" />
      {formatElapsed(duration)}
    </button>
  )
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
