// app/dashboard/ehr/outcomes/page.tsx
// Practice-wide outcome aggregates: for each instrument, show the
// mean/median of latest scores, the reliable-change distribution
// (improved/stable/worsened), and a severity-band histogram.

'use client'

import { useEffect, useState } from 'react'
import { Activity, TrendingDown, TrendingUp, Minus } from 'lucide-react'

type Report = {
  instrument: string
  max: number
  patient_count: number
  mean: number | null
  median: number | null
  improved: number
  stable: number
  worsened: number
  reliable_change_threshold: number
  distribution: Array<{ label: string; count: number }>
}

export default function OutcomesPage() {
  const [data, setData] = useState<Report[] | null>(null)

  useEffect(() => {
    (async () => {
      const r = await fetch('/api/ehr/reports/outcomes')
      if (r.ok) setData((await r.json()).reports || [])
    })()
  }, [])

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <Activity className="w-6 h-6 text-teal-600" />
          Practice outcomes
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Across your whole panel, by instrument. Reliable improvement = change from baseline greater than the instrument&apos;s RCI threshold.
        </p>
      </div>

      {data === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : data.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-sm text-gray-500">
          No completed assessments yet.
        </div>
      ) : (
        data.map((r) => (
          <div key={r.instrument} className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div>
                <div className="text-lg font-semibold text-gray-900">{r.instrument}</div>
                <div className="text-xs text-gray-500">
                  {r.patient_count} patient{r.patient_count === 1 ? '' : 's'} · RCI threshold ±{r.reliable_change_threshold}
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-gray-900 font-mono">{r.mean ?? '—'}</div>
                <div className="text-[11px] text-gray-500">mean (median {r.median ?? '—'})</div>
              </div>
            </div>

            {/* Reliable change summary */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <OutcomeStat
                icon={<TrendingDown className="w-4 h-4" />}
                label="Improved"
                value={r.improved}
                total={r.improved + r.stable + r.worsened}
                accent="green"
              />
              <OutcomeStat
                icon={<Minus className="w-4 h-4" />}
                label="Stable"
                value={r.stable}
                total={r.improved + r.stable + r.worsened}
                accent="gray"
              />
              <OutcomeStat
                icon={<TrendingUp className="w-4 h-4" />}
                label="Worsened"
                value={r.worsened}
                total={r.improved + r.stable + r.worsened}
                accent="red"
              />
            </div>

            {/* Distribution of latest scores */}
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Latest-score distribution</div>
              <div className="grid grid-cols-5 gap-2">
                {r.distribution.map((b) => {
                  const pct = (r.patient_count ? (b.count / r.patient_count) * 100 : 0).toFixed(0)
                  return (
                    <div key={b.label} className="bg-gray-50 rounded-lg p-2">
                      <div className="text-[10px] uppercase tracking-wider text-gray-500 truncate">{b.label}</div>
                      <div className="text-lg font-bold text-gray-900">{b.count}</div>
                      <div className="text-[10px] text-gray-500">{pct}%</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function OutcomeStat({ icon, label, value, total, accent }: {
  icon: React.ReactNode; label: string; value: number; total: number; accent: 'green' | 'gray' | 'red'
}) {
  const cls =
    accent === 'green' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
    : accent === 'red' ? 'bg-red-50 text-red-800 border-red-200'
    : 'bg-gray-50 text-gray-700 border-gray-200'
  const pct = total ? Math.round((value / total) * 100) : 0
  return (
    <div className={`rounded-lg p-3 border ${cls}`}>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider">
        {icon}{label}
      </div>
      <div className="text-xl font-bold mt-1">{value}</div>
      <div className="text-[10px]">{pct}%</div>
    </div>
  )
}
