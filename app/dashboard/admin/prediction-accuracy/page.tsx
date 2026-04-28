// app/dashboard/admin/prediction-accuracy/page.tsx
//
// W45 T7 — internal dashboard. For each prediction kind, show
// 30/60/90-day prediction volume, base rates, precision/recall at
// the 0.5 threshold, calibration curve (predicted score bucket vs
// actual rate), and a weekly trend.

'use client'

import { useEffect, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend, ReferenceLine,
} from 'recharts'

type Window = {
  total_predictions: number
  matured: number
  positives_actual: number
  true_positives: number
  false_positives: number
  false_negatives: number
  true_negatives: number
  precision: number | null
  recall: number | null
  base_rate: number | null
}
type CalibrationBucket = { bucket: string; bucket_low: number; predicted_count: number; actual_rate: number }
type KindSummary = {
  kind: string
  windows: Record<'30'|'60'|'90', Window>
  calibration: CalibrationBucket[]
  trend: Array<{ week_start: string; predictions: number; positives: number }>
}

function pct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(0)}%`
}

export default function PredictionAccuracyPage() {
  const [data, setData] = useState<{ kinds: KindSummary[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/ehr/admin/prediction-accuracy')
        if (!res.ok) throw new Error(`Failed (${res.status})`)
        setData(await res.json())
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Prediction accuracy</h1>
        <p className="text-sm text-gray-600 mt-1">
          Internal feedback on heuristic prediction quality. Use this to
          decide when a heuristic is good enough vs when to invest in ML.
          Outcomes mature once the predicted event has resolved (slot
          passed for no-show; 30-day window passed for dropout).
        </p>
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {data?.kinds.map((k) => (
        <section key={k.kind} className="space-y-4">
          <h2 className="text-lg font-medium capitalize">{k.kind.replace(/_/g, ' ')}</h2>

          {/* Window summary */}
          <div className="overflow-x-auto bg-white border rounded">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2">Window</th>
                  <th className="text-right px-3 py-2">Predictions</th>
                  <th className="text-right px-3 py-2">Matured</th>
                  <th className="text-right px-3 py-2">Base rate</th>
                  <th className="text-right px-3 py-2">Precision @50%</th>
                  <th className="text-right px-3 py-2">Recall @50%</th>
                  <th className="text-right px-3 py-2">TP / FP / FN / TN</th>
                </tr>
              </thead>
              <tbody>
                {(['30','60','90'] as const).map((w) => {
                  const b = k.windows[w]
                  return (
                    <tr key={w} className="border-t">
                      <td className="px-3 py-2">Last {w} days</td>
                      <td className="px-3 py-2 text-right">{b.total_predictions}</td>
                      <td className="px-3 py-2 text-right">{b.matured}</td>
                      <td className="px-3 py-2 text-right">{pct(b.base_rate)}</td>
                      <td className="px-3 py-2 text-right">{pct(b.precision)}</td>
                      <td className="px-3 py-2 text-right">{pct(b.recall)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {b.true_positives} / {b.false_positives} / {b.false_negatives} / {b.true_negatives}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Calibration curve */}
          <div className="bg-white border rounded p-3">
            <h3 className="text-sm font-medium mb-2">Calibration curve</h3>
            <p className="text-xs text-gray-500 mb-3">
              Predicted-score bucket vs. actual outcome rate. A perfectly-calibrated heuristic
              hugs the diagonal — when the model says 70%, the actual rate should be 70%.
            </p>
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer>
                <LineChart data={k.calibration}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                  <Tooltip formatter={(v: any) => typeof v === 'number' ? `${(v * 100).toFixed(0)}%` : v} />
                  <ReferenceLine
                    segment={[{ x: '0-10%', y: 0.05 }, { x: '90-100%', y: 0.95 }]}
                    stroke="#9ca3af"
                    strokeDasharray="4 4"
                  />
                  <Line type="monotone" dataKey="actual_rate" stroke="#1f375d" strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Weekly trend */}
          {k.trend.length > 0 && (
            <div className="bg-white border rounded p-3">
              <h3 className="text-sm font-medium mb-2">Weekly volume + positives</h3>
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={k.trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="week_start" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="predictions" fill="#52bfc0" />
                    <Bar dataKey="positives"   fill="#dc3545" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
