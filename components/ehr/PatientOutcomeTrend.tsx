// components/ehr/PatientOutcomeTrend.tsx
//
// W52 D3 — sparkline of PHQ-9 + GAD-7 (and any others) over time.

'use client'

import { useEffect, useMemo, useState } from 'react'

interface SeriesPoint { date: string; score: number; severity: string | null }
interface Summary { baseline: number; current: number; delta: number; n: number }

const SLUG_LABEL: Record<string, string> = {
  'phq-9':  'PHQ-9 · Depression',
  'gad-7':  'GAD-7 · Anxiety',
  'pcl-5':  'PCL-5 · PTSD',
  'audit-c':'AUDIT-C · Alcohol',
}

const MAX_SCORE: Record<string, number> = {
  'phq-9': 27, 'gad-7': 21, 'pcl-5': 80, 'audit-c': 12,
}

export default function PatientOutcomeTrend({ patientId }: { patientId: string }) {
  const [series, setSeries] = useState<Record<string, SeriesPoint[]> | null>(null)
  const [summary, setSummary] = useState<Record<string, Summary>>({})

  useEffect(() => {
    let cancelled = false
    fetch(`/api/ehr/patients/${patientId}/outcome-trend`)
      .then(r => r.ok ? r.json() : { series: {}, summary: {} })
      .then(j => {
        if (cancelled) return
        setSeries(j.series ?? {}); setSummary(j.summary ?? {})
      })
      .catch(() => { if (!cancelled) setSeries({}) })
    return () => { cancelled = true }
  }, [patientId])

  const slugs = useMemo(() => series ? Object.keys(series).filter(s => series[s].length > 0) : [], [series])

  if (series === null) return <div className="text-sm text-gray-400">Loading…</div>
  if (slugs.length === 0) {
    return <div className="text-sm text-gray-400">No completed assessments yet.</div>
  }

  return (
    <div className="space-y-4">
      {slugs.map(slug => {
        const data = series![slug]
        const max = MAX_SCORE[slug] ?? Math.max(...data.map(d => d.score), 10)
        const w = 240, h = 50
        const pad = 4
        const stepX = data.length > 1 ? (w - pad * 2) / (data.length - 1) : 0
        const points = data.map((d, i) => {
          const x = pad + i * stepX
          const y = h - pad - (d.score / max) * (h - pad * 2)
          return `${x},${y}`
        }).join(' ')
        const s = summary[slug]
        const delta = s ? s.delta : 0
        const trendColor = delta < 0 ? '#10b981' : delta > 0 ? '#ef4444' : '#6b7280'

        return (
          <div key={slug} className="border border-gray-200 rounded-md p-3">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-sm font-medium text-gray-900">{SLUG_LABEL[slug] ?? slug.toUpperCase()}</div>
                <div className="text-xs text-gray-500">{data.length} measurement{data.length === 1 ? '' : 's'}</div>
              </div>
              {s && (
                <div className="text-right">
                  <div className="text-xs text-gray-500">Current {s.current} / Baseline {s.baseline}</div>
                  <div className="text-xs font-medium" style={{ color: trendColor }}>
                    {delta === 0 ? 'No change' : delta < 0 ? `↓ ${Math.abs(delta)} pts` : `↑ ${delta} pts`}
                  </div>
                </div>
              )}
            </div>
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block mt-2">
              <polyline points={points} fill="none" stroke={trendColor} strokeWidth="2" />
              {data.map((d, i) => {
                const x = pad + i * stepX
                const y = h - pad - (d.score / max) * (h - pad * 2)
                return <circle key={i} cx={x} cy={y} r={2.5} fill={trendColor}><title>{d.date.slice(0,10)}: {d.score}{d.severity ? ' · '+d.severity : ''}</title></circle>
              })}
            </svg>
          </div>
        )
      })}
    </div>
  )
}
