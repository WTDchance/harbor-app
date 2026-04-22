// app/dashboard/ehr/caseload/page.tsx — whole-panel view.

'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Users, Filter } from 'lucide-react'

type Row = {
  id: string; name: string; phone: string | null; email: string | null
  referral_source: string | null; patient_since: string
  last_appt: string | null; next_appt: string | null
  open_notes: number
  phq_latest: number | null; phq_latest_date: string | null; phq_delta: number | null
  last_mood: number | null; last_mood_date: string | null
  balance_cents: number
}

type Filter = 'all' | 'needs_docs' | 'stale_60' | 'no_next_appt' | 'balance_owed'

function daysAgo(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).getTime()
  return Math.floor((Date.now() - d) / (24 * 60 * 60 * 1000))
}
function cents(n: number): string { return `$${(n / 100).toFixed(2)}` }

export default function CaseloadPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    (async () => {
      const r = await fetch('/api/ehr/reports/caseload')
      if (r.ok) setRows((await r.json()).rows || [])
    })()
  }, [])

  const filtered = useMemo(() => {
    if (!rows) return []
    return rows.filter((r) => {
      if (filter === 'needs_docs') return r.open_notes > 0
      if (filter === 'stale_60') {
        const d = daysAgo(r.last_appt)
        return d != null && d >= 60
      }
      if (filter === 'no_next_appt') return !r.next_appt
      if (filter === 'balance_owed') return r.balance_cents > 0
      return true
    })
  }, [rows, filter])

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-teal-600" />
            Caseload
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Every active patient at a glance. Filter to find the ones that need attention today.
          </p>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-gray-400" />
        <FilterChip value="all" current={filter} onClick={setFilter} label="All" />
        <FilterChip value="needs_docs" current={filter} onClick={setFilter} label="Open notes" />
        <FilterChip value="stale_60" current={filter} onClick={setFilter} label="Not seen in 60+ days" />
        <FilterChip value="no_next_appt" current={filter} onClick={setFilter} label="No next appt" />
        <FilterChip value="balance_owed" current={filter} onClick={setFilter} label="Balance owed" />
        <span className="text-xs text-gray-500 ml-auto">{filtered.length} patients</span>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {rows === null ? (
          <div className="p-8 text-sm text-gray-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-500">No patients match this filter.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Patient</th>
                <th className="text-left px-4 py-2">Last seen</th>
                <th className="text-left px-4 py-2">Next</th>
                <th className="text-right px-4 py-2">Open notes</th>
                <th className="text-right px-4 py-2">Latest PHQ-9</th>
                <th className="text-right px-4 py-2">Mood</th>
                <th className="text-right px-4 py-2">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r) => {
                const since = daysAgo(r.last_appt)
                const stale = since != null && since >= 60
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <Link href={`/dashboard/patients/${r.id}`} className="text-sm text-teal-700 hover:text-teal-900 font-medium">
                        {r.name}
                      </Link>
                      {r.referral_source && <div className="text-[10px] text-gray-400">via {r.referral_source}</div>}
                    </td>
                    <td className={`px-4 py-2 text-xs ${stale ? 'text-amber-700' : 'text-gray-600'}`}>
                      {r.last_appt ? (
                        <>{new Date(r.last_appt + 'T12:00:00').toLocaleDateString()} <span className="text-gray-400">({since}d)</span></>
                      ) : <span className="text-gray-400 italic">Never</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600">
                      {r.next_appt ? new Date(r.next_appt + 'T12:00:00').toLocaleDateString() : <span className="text-gray-400 italic">—</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-right">
                      {r.open_notes > 0 ? (
                        <span className="inline-block px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                          {r.open_notes}
                        </span>
                      ) : <span className="text-gray-300">0</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-right font-mono">
                      {r.phq_latest != null ? (
                        <>
                          <span className="text-gray-900 font-semibold">{r.phq_latest}</span>
                          {r.phq_delta != null && r.phq_delta !== 0 && (
                            <span className={`ml-1 ${r.phq_delta < 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                              ({r.phq_delta > 0 ? '+' : ''}{r.phq_delta})
                            </span>
                          )}
                        </>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-right">
                      {r.last_mood != null ? (
                        <span className={`inline-block w-6 h-6 rounded-full text-white font-mono text-[10px] leading-6 text-center ${
                          r.last_mood <= 3 ? 'bg-red-500' : r.last_mood <= 5 ? 'bg-orange-400' : r.last_mood <= 7 ? 'bg-amber-400' : 'bg-emerald-500'
                        }`}>{r.last_mood}</span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className={`px-4 py-2 text-xs text-right font-mono ${r.balance_cents > 0 ? 'text-amber-700 font-semibold' : 'text-gray-400'}`}>
                      {r.balance_cents > 0 ? cents(r.balance_cents) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function FilterChip({ value, current, onClick, label }: { value: any; current: any; onClick: (v: any) => void; label: string }) {
  return (
    <button
      onClick={() => onClick(value)}
      className={`text-xs px-2.5 py-1 rounded-full border ${
        current === value ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-700 border-gray-200 hover:border-teal-500'
      }`}
    >
      {label}
    </button>
  )
}
