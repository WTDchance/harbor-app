// components/ehr/PatientTimelineSparkline.tsx
//
// W50 D4 — 90-day rolling activity heatmap-sparkline. Each day is a
// small rect coloured by intensity. Hover reveals that day's event count.
// Renders as a ~120×30 SVG.

'use client'

import { useEffect, useMemo, useState } from 'react'

interface RawEvent { occurred_at: string }

export default function PatientTimelineSparkline({
  patientId, days = 90, width = 120, height = 30,
}: { patientId: string; days?: number; width?: number; height?: number }) {
  const [events, setEvents] = useState<RawEvent[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const to = new Date().toISOString().slice(0, 10)
    const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    fetch(`/api/ehr/patients/${patientId}/timeline?from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() : { events: [] })
      .then(j => { if (!cancelled) setEvents(j.events ?? []) })
      .catch(() => { if (!cancelled) setEvents([]) })
    return () => { cancelled = true }
  }, [patientId, days])

  const { buckets, max } = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of events ?? []) {
      const day = (e.occurred_at || '').slice(0, 10)
      if (!day) continue
      map.set(day, (map.get(day) ?? 0) + 1)
    }
    const series: { day: string; count: number }[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
      series.push({ day: d, count: map.get(d) ?? 0 })
    }
    const max = series.reduce((m, b) => Math.max(m, b.count), 0)
    return { buckets: series, max }
  }, [events, days])

  if (events === null) return <div className="text-xs text-gray-400">…</div>

  const cellW = width / days
  const intensity = (n: number) => {
    if (max === 0 || n === 0) return 0
    return Math.min(1, n / max)
  }
  const fill = (n: number) => {
    const a = intensity(n)
    if (a === 0) return '#f3f4f6'
    if (a < 0.34) return '#bfdbfe'
    if (a < 0.67) return '#60a5fa'
    return '#1d4ed8'
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block" role="img"
      aria-label={`${days}-day activity sparkline`}>
      {buckets.map((b, i) => (
        <rect key={b.day}
          x={i * cellW} y={2} width={Math.max(1, cellW - 1)} height={height - 4}
          rx={1} ry={1}
          fill={fill(b.count)}>
          <title>{b.day}: {b.count} event{b.count === 1 ? '' : 's'}</title>
        </rect>
      ))}
    </svg>
  )
}
