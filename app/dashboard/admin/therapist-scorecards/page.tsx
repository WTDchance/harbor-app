// app/dashboard/admin/therapist-scorecards/page.tsx
//
// W47 T3 — admin comparison view of all therapists. Sortable
// columns, date-range picker, CSV export. Practice owner / supervisor
// only (gated by ADMIN_EMAIL allowlist on the API).

'use client'

import { useEffect, useMemo, useState } from 'react'

type Row = {
  therapist_id: string
  therapist_name: string
  scheduled_count: number
  kept_count: number
  no_show_count: number
  late_cancel_count: number
  cancelled_count: number
  distinct_patients_seen: number
  kept_rate: number
  no_show_rate: number
  late_cancel_rate: number
  notes_total: number
  timely_note_rate: number
  avg_duration_minutes: number | null
  cosign_required_count: number
  cosign_completed_count: number
  avg_cosign_hours: number | null
  retention_rate: number
  retention_first_seen: number
  retention_retained: number
  avg_phq9_delta: number | null
  phq9_patients: number
}

function pct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(0)}%`
}

function startOfMonth() {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

type SortKey = keyof Row

export default function TherapistScorecardsPage() {
  const [from, setFrom] = useState(startOfMonth())
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('scheduled_count')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  async function load() {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/ehr/admin/therapist-scorecards?from=${from}&to=${to}`)
      if (res.status === 403) throw new Error('Admin only.')
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const j = await res.json()
      setRows(j.rows || [])
    } catch (e) {
      setError((e as Error).message)
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [from, to])

  const sorted = useMemo(() => {
    const cp = [...rows]
    cp.sort((a, b) => {
      const av = a[sortKey] as any; const bv = b[sortKey] as any
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av
      }
      const as = String(av); const bs = String(bv)
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
    })
    return cp
  }, [rows, sortKey, sortDir])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('desc') }
  }
  function exportCsv() {
    window.location.href = `/api/ehr/admin/therapist-scorecards?from=${from}&to=${to}&format=csv`
  }

  function H({ k, label, align }: { k: SortKey; label: string; align?: 'left' | 'right' }) {
    const on = sortKey === k
    return (
      <th className={`px-3 py-2 cursor-pointer select-none ${align === 'right' ? 'text-right' : 'text-left'}`}
          onClick={() => toggleSort(k)}>
        {label}{on ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
      </th>
    )
  }

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Therapist scorecards</h1>
          <p className="text-sm text-gray-600 mt-1">
            All therapists side-by-side. Sortable columns. Owner /
            supervisor only — privacy boundary against regular clinicians.
          </p>
        </div>
        <button onClick={exportCsv}
                className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm">
          Export CSV
        </button>
      </div>

      <div className="flex items-end gap-3">
        <label className="text-sm">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                 className="block border rounded px-2 py-1 mt-1" />
        </label>
        <label className="text-sm">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                 className="block border rounded px-2 py-1 mt-1" />
        </label>
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="bg-white rounded border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-600">
            <tr>
              <H k="therapist_name"        label="Therapist" />
              <H k="scheduled_count"       label="Sched"     align="right" />
              <H k="kept_rate"             label="Kept"      align="right" />
              <H k="no_show_rate"          label="No-show"   align="right" />
              <H k="late_cancel_rate"      label="Late"      align="right" />
              <H k="distinct_patients_seen" label="Patients" align="right" />
              <H k="avg_duration_minutes"  label="Avg dur"   align="right" />
              <H k="timely_note_rate"      label="≤72h"      align="right" />
              <H k="avg_cosign_hours"      label="Cosign h"  align="right" />
              <H k="retention_rate"        label="Retention" align="right" />
              <H k="avg_phq9_delta"        label="ΔPHQ-9"    align="right" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="px-3 py-3 text-gray-500">Loading…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={11} className="px-3 py-3 text-gray-500">No data.</td></tr>
            ) : sorted.map((r) => (
              <tr key={r.therapist_id} className="border-t">
                <td className="px-3 py-2 font-medium">{r.therapist_name}</td>
                <td className="px-3 py-2 text-right">{r.scheduled_count}</td>
                <td className="px-3 py-2 text-right">{pct(r.kept_rate)}</td>
                <td className="px-3 py-2 text-right">{pct(r.no_show_rate)}</td>
                <td className="px-3 py-2 text-right">{pct(r.late_cancel_rate)}</td>
                <td className="px-3 py-2 text-right">{r.distinct_patients_seen}</td>
                <td className="px-3 py-2 text-right">{r.avg_duration_minutes ? `${Math.round(r.avg_duration_minutes)}m` : '—'}</td>
                <td className="px-3 py-2 text-right">{pct(r.timely_note_rate)}</td>
                <td className="px-3 py-2 text-right">
                  {r.cosign_required_count > 0
                    ? (r.avg_cosign_hours != null ? `${r.avg_cosign_hours.toFixed(1)}h` : 'pending')
                    : '—'}
                </td>
                <td className="px-3 py-2 text-right">{pct(r.retention_rate)}<span className="text-xs text-gray-400 ml-1">({r.retention_retained}/{r.retention_first_seen})</span></td>
                <td className="px-3 py-2 text-right">
                  {r.avg_phq9_delta != null ? (
                    <span className={r.avg_phq9_delta < 0 ? 'text-green-700' : 'text-red-700'}>
                      {r.avg_phq9_delta > 0 ? '+' : ''}{r.avg_phq9_delta.toFixed(1)}
                    </span>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        ΔPHQ-9 = average score change for patients with ≥2 PHQ-9 administrations
        in the window, last minus first. Negative = improvement.
        Retention = patients with at least one follow-up (completed, scheduled,
        or confirmed) within 30 days of their first session in the window.
      </p>
    </div>
  )
}
