// components/today/widgets/MoodHeatmapPracticeAggregate.tsx
// W47 T0 — practice-wide aggregate of W46 T5 daily check-ins. Hides
// itself if no check-ins exist yet so unused practices don't see a
// blank widget.

'use client'
import { useEffect, useState } from 'react'

type DailyAvg = { day: string; avg_mood: number; count: number }

export default function MoodHeatmapWidget() {
  const [days, setDays] = useState<DailyAvg[] | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/ehr/admin/checkins/practice-aggregate?days=30').catch(() => null)
        if (!res || !res.ok) { setDays([]); return }
        const j = await res.json()
        setDays(j.days || [])
      } catch { setDays([]) }
    })()
  }, [])

  if (!days || days.length === 0) return null

  const colorFor = (mood: number) => {
    if (mood >= 4.2) return '#10b981'
    if (mood >= 3.4) return '#52bfc0'
    if (mood >= 2.6) return '#9ca3af'
    if (mood >= 1.8) return '#f59e0b'
    return '#dc2626'
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2 px-1">
        Patient mood (last 30d)
      </h2>
      <div className="bg-white border border-gray-200 rounded-xl p-3">
        <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(30, minmax(0, 1fr))' }}>
          {days.map((d) => (
            <div key={d.day}
                 title={`${d.day} · avg ${d.avg_mood.toFixed(1)} (${d.count} check-ins)`}
                 className="h-5 rounded-sm"
                 style={{ backgroundColor: d.count === 0 ? '#f3f4f6' : colorFor(d.avg_mood) }} />
          ))}
        </div>
      </div>
    </div>
  )
}
