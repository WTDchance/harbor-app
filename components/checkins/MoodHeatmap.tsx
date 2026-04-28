// components/checkins/MoodHeatmap.tsx
//
// W46 T5 — therapist-side 30-day mood/symptom heatmap.

'use client'

import { useEffect, useState } from 'react'

type Checkin = {
  day: string
  mood_score: number
  symptoms: string[]
  note: string | null
  prompted_via: string
}

const MOOD_COLOR: Record<number, string> = {
  1: '#dc2626',  // red — very low
  2: '#f59e0b',  // amber
  3: '#9ca3af',  // gray — neutral
  4: '#52bfc0',  // teal
  5: '#10b981',  // green — great
}

export default function MoodHeatmap({ patientId, days = 30 }: { patientId: string; days?: number }) {
  const [data, setData] = useState<{ checkins: Checkin[]; days: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [hover, setHover] = useState<Checkin | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/ehr/patients/${patientId}/checkins?days=${days}`)
        if (!res.ok) return
        setData(await res.json())
      } finally {
        setLoading(false)
      }
    })()
  }, [patientId, days])

  if (loading) return null
  if (!data || data.checkins.length === 0) {
    return (
      <p className="text-xs text-gray-500">
        No daily check-ins yet. Encourage your patient to enable the daily check-in
        in their portal.
      </p>
    )
  }

  // Build a date → score map.
  const scoreByDay = new Map<string, Checkin>()
  for (const c of data.checkins) scoreByDay.set(c.day, c)

  // Build the visible day range — last `days` days inclusive.
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const cells: Array<{ day: string; checkin: Checkin | null }> = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const key = d.toISOString().slice(0, 10)
    cells.push({ day: key, checkin: scoreByDay.get(key) || null })
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}>
        {cells.map((c) => (
          <div
            key={c.day}
            onMouseEnter={() => setHover(c.checkin)}
            onMouseLeave={() => setHover(null)}
            className="h-5 rounded-sm border border-gray-200"
            style={{
              backgroundColor: c.checkin ? MOOD_COLOR[c.checkin.mood_score] : '#f3f4f6',
            }}
            title={c.checkin
              ? `${c.day} · mood ${c.checkin.mood_score}${c.checkin.symptoms.length > 0 ? ` · ${c.checkin.symptoms.join(', ')}` : ''}`
              : `${c.day} · no check-in`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{cells[0].day}</span>
        <span>{cells[cells.length - 1].day}</span>
      </div>
      {hover && (
        <div className="rounded bg-white border p-2 text-xs space-y-0.5">
          <div className="font-medium">{hover.day}</div>
          <div>Mood: {hover.mood_score}</div>
          {hover.symptoms.length > 0 && (
            <div>Symptoms: {hover.symptoms.join(', ')}</div>
          )}
          {hover.note && <div className="text-gray-600">"{hover.note}"</div>}
        </div>
      )}
    </div>
  )
}
