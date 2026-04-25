// components/ehr/MoodLogsCard.tsx
// Therapist-side view of a patient's between-session mood check-ins.
// Calendar-style heat strip of the last 30 days + the most recent note.

'use client'

import { useEffect, useState } from 'react'
import { Smile } from 'lucide-react'
import { usePreferences } from '@/lib/ehr/use-preferences'

type Log = {
  id: string
  mood: number
  anxiety: number | null
  sleep_hours: number | null
  note: string | null
  logged_at: string
}

export function MoodLogsCard({ patientId }: { patientId: string }) {
  const { prefs } = usePreferences()
  const [logs, setLogs] = useState<Log[] | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/ehr/mood-logs?patient_id=${encodeURIComponent(patientId)}`)
        if (res.status === 403) { if (!cancelled) setEnabled(false); return }
        const json = await res.json()
        if (!cancelled) setLogs(json.logs || [])
      } finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [patientId])

  if (!enabled || loading) return null
  if (prefs && prefs.features.mood_logs === false) return null
  if (!logs || logs.length === 0) return null

  const lastNote = [...logs].reverse().find((l) => l.note && l.note.trim())
  const avg7 = avgMood(logs.slice(-7))
  const avg30 = avgMood(logs)

  // Build last-30-days heat row
  const today = new Date()
  const days: Array<{ date: string; mood?: number }> = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const iso = d.toISOString().slice(0, 10)
    const match = logs.find((l) => l.logged_at.slice(0, 10) === iso)
    days.push({ date: iso, mood: match?.mood })
  }

  return (
    <div className="bg-white border rounded-lg p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <Smile className="w-4 h-4 text-gray-500" />
          Between-session check-ins
        </h2>
        <div className="text-xs text-gray-500">
          7-day avg <strong className="text-gray-900">{avg7?.toFixed(1) ?? '—'}</strong>
          <span className="mx-1">·</span>
          30-day avg <strong className="text-gray-900">{avg30?.toFixed(1) ?? '—'}</strong>
        </div>
      </div>

      <div className="flex gap-0.5 mb-2">
        {days.map((d, i) => (
          <div
            key={i}
            title={`${d.date} ${d.mood ? '· mood ' + d.mood + '/10' : '· no check-in'}`}
            className={`flex-1 rounded-sm h-6 ${
              d.mood == null
                ? 'bg-gray-100'
                : d.mood <= 3
                ? 'bg-red-500'
                : d.mood <= 5
                ? 'bg-orange-400'
                : d.mood <= 7
                ? 'bg-amber-400'
                : 'bg-emerald-500'
            }`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 mb-3">
        <span>30 days ago</span><span>today</span>
      </div>

      {lastNote && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700">
          <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">
            Latest note · {new Date(lastNote.logged_at).toLocaleDateString()}
          </div>
          {lastNote.note}
        </div>
      )}
    </div>
  )
}

function avgMood(logs: Log[]): number | null {
  if (!logs.length) return null
  return logs.reduce((s, l) => s + l.mood, 0) / logs.length
}
