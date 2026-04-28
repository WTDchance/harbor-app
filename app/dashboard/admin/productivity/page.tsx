// app/dashboard/admin/productivity/page.tsx
//
// W44 T1 — therapist productivity report. Admin/supervisor scoped.
// Shows per-therapist sessions, kept rate, no-show rate, late-cancel
// rate, timely-note rate, and cosign turnaround across a selectable
// date range.

'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LineChart,
  Line,
} from 'recharts'

type Row = {
  therapist_id: string | null
  therapist_name: string | null
  scheduled_count: number
  kept_count: number
  no_show_count: number
  late_cancel_count: number
  cancelled_count: number
  kept_rate: number
  no_show_rate: number
  late_cancel_rate: number
  notes_total: number
  notes_signed_within_72h: number
  timely_note_rate: number
  avg_duration_minutes: number | null
  cosign_required_count: number
  cosign_completed_count: number
  avg_cosign_hours: number | null
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`
}

function firstOfMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

export default function ProductivityPage() {
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ehr/admin/productivity?from=${from}&to=${to}`)
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const j = await res.json()
      setRows(j.rows || [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [from, to])

  const sessionData = useMemo(
    () => rows.map((r) => ({
      name: (r.therapist_name || '—').replace(/^\s+|\s+$/g, '') || '—',
      Sessions: r.kept_count,
      'No-shows': r.no_show_count,
      'Late cancels': r.late_cancel_count,
    })),
    [rows],
  )

  const rateData = useMemo(
    () => rows.map((r) => ({
      name: (r.therapist_name || '—').replace(/^\s+|\s+$/g, '') || '—',
      'Kept rate':       Math.round(r.kept_rate * 100),
      'Timely-note rate': Math.round(r.timely_note_rate * 100),
    })),
    [rows],
  )

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Therapist productivity</h1>
        <p className="text-sm text-gray-600 mt-1">
          Sessions, kept rate, no-show rate, and timely-note rate per
          therapist for the selected period.
        </p>
      </div>

      <div className="flex items-end gap-3">
        <label className="text-sm">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="block border rounded px-2 py-1 mt-1"
          />
        </label>
        <label className="text-sm">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="block border rounded px-2 py-1 mt-1"
          />
        </label>
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">No data in this range.</p>
      ) : (
        <>
          {/* Sessions / no-shows / late cancels — stacked bars */}
          <section className="bg-white rounded border p-4">
            <h2 className="text-lg font-medium mb-3">Session volume</h2>
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={sessionData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-15} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Sessions"     stackId="a" fill="#1f375d" />
                  <Bar dataKey="No-shows"     stackId="a" fill="#dc3545" />
                  <Bar dataKey="Late cancels" stackId="a" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Kept-rate + timely-note rate — line */}
          <section className="bg-white rounded border p-4">
            <h2 className="text-lg font-medium mb-3">Quality rates (%)</h2>
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer>
                <LineChart data={rateData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-15} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 12 }} domain={[0, 100]} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="Kept rate"        stroke="#52bfc0" strokeWidth={2} />
                  <Line type="monotone" dataKey="Timely-note rate" stroke="#3e85af" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Detail table */}
          <section className="bg-white rounded border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2">Therapist</th>
                  <th className="text-right px-3 py-2">Sessions</th>
                  <th className="text-right px-3 py-2">Kept</th>
                  <th className="text-right px-3 py-2">No-show</th>
                  <th className="text-right px-3 py-2">Late cancel</th>
                  <th className="text-right px-3 py-2">Avg dur</th>
                  <th className="text-right px-3 py-2">Notes</th>
                  <th className="text-right px-3 py-2">≤72h</th>
                  <th className="text-right px-3 py-2">Cosign avg (h)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.therapist_id || 'unassigned'} className="border-t">
                    <td className="px-3 py-2 font-medium">{r.therapist_name}</td>
                    <td className="px-3 py-2 text-right">{r.scheduled_count}</td>
                    <td className="px-3 py-2 text-right">{r.kept_count} <span className="text-gray-400 text-xs">({pct(r.kept_rate)})</span></td>
                    <td className="px-3 py-2 text-right">{r.no_show_count} <span className="text-gray-400 text-xs">({pct(r.no_show_rate)})</span></td>
                    <td className="px-3 py-2 text-right">{r.late_cancel_count} <span className="text-gray-400 text-xs">({pct(r.late_cancel_rate)})</span></td>
                    <td className="px-3 py-2 text-right">{r.avg_duration_minutes ? `${Math.round(r.avg_duration_minutes)}m` : '—'}</td>
                    <td className="px-3 py-2 text-right">{r.notes_total}</td>
                    <td className="px-3 py-2 text-right">{pct(r.timely_note_rate)}</td>
                    <td className="px-3 py-2 text-right">
                      {r.cosign_required_count > 0
                        ? (r.avg_cosign_hours ? `${r.avg_cosign_hours.toFixed(1)}` : 'pending')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}
