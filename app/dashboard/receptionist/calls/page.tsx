// app/dashboard/receptionist/calls/page.tsx
//
// W50 D5 — receptionist call review list. Filters, outcome badges,
// tally strip across the top.

'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

interface Call {
  id: string
  created_at: string
  from_number: string | null
  duration_seconds: number | null
  summary: string | null
  patient_id: string | null
  outcome: 'booked' | 'cancelled_call' | 'no_record_created' | 'crisis_flagged'
  inferred_crisis_risk: boolean | null
  patient_active_flags: string[] | null
}

interface Tally {
  total: number; captured_patient: number; crisis: number; booked: number; avg_duration_seconds: number; since: string; until: string
}

const OUTCOME_LABEL: Record<Call['outcome'], { label: string; cls: string }> = {
  booked:            { label: 'Booked',            cls: 'bg-emerald-50 border-emerald-300 text-emerald-700' },
  cancelled_call:    { label: 'Caller hung up',    cls: 'bg-amber-50 border-amber-300 text-amber-700' },
  no_record_created: { label: 'No record',         cls: 'bg-gray-50 border-gray-300 text-gray-600' },
  crisis_flagged:    { label: 'Crisis flagged',    cls: 'bg-red-50 border-red-300 text-red-700' },
}

export default function ReceptionistCallsPage() {
  const [calls, setCalls] = useState<Call[] | null>(null)
  const [tally, setTally] = useState<Tally | null>(null)
  const [outcome, setOutcome] = useState<'all' | Call['outcome']>('all')
  const [crisisOnly, setCrisisOnly] = useState(false)
  const [from, setFrom] = useState<string>(() => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10))
  const [to, setTo] = useState<string>(() => new Date().toISOString().slice(0, 10))

  async function load() {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    params.set('outcome', outcome)
    if (crisisOnly) params.set('crisis', '1')
    const [c, t] = await Promise.all([
      fetch(`/api/ehr/receptionist/calls?${params}`).then(r => r.ok ? r.json() : { calls: [] }),
      fetch(`/api/ehr/receptionist/tally?since=${from}&until=${to}`).then(r => r.ok ? r.json() : null),
    ])
    setCalls(c.calls ?? [])
    setTally(t)
  }
  useEffect(() => { void load() }, [from, to, outcome, crisisOnly])

  const successRate = useMemo(() => {
    if (!tally || tally.total === 0) return 0
    return Math.round((tally.booked / tally.total) * 100)
  }, [tally])

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Receptionist call review</h1>
      <p className="text-sm text-gray-500 mb-6">Inspect what Ellie captured per call. Edit corrections to feed the training set.</p>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <Stat label="Total calls" value={tally?.total ?? 0} />
        <Stat label="Booked" value={tally?.booked ?? 0} sub={`${successRate}% success`} />
        <Stat label="Captured patient" value={tally?.captured_patient ?? 0} />
        <Stat label="Crisis-flagged" value={tally?.crisis ?? 0} tone={tally?.crisis ? 'red' : 'gray'} />
        <Stat label="Avg duration" value={tally?.avg_duration_seconds != null ? `${Math.round(tally.avg_duration_seconds / 60)}m ${tally.avg_duration_seconds % 60}s` : '—'} />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4 flex flex-wrap gap-2 items-center">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Filter:</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border rounded px-2 py-1 text-xs" />
        <span className="text-xs text-gray-400">→</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded px-2 py-1 text-xs" />
        <select value={outcome} onChange={e => setOutcome(e.target.value as any)} className="border rounded px-2 py-1 text-xs ml-2">
          <option value="all">All outcomes</option>
          <option value="booked">Booked</option>
          <option value="cancelled_call">Caller hung up</option>
          <option value="no_record_created">No record</option>
          <option value="crisis_flagged">Crisis flagged</option>
        </select>
        <label className="inline-flex items-center gap-1 text-xs ml-2">
          <input type="checkbox" checked={crisisOnly} onChange={e => setCrisisOnly(e.target.checked)} /> Crisis only
        </label>
      </div>

      {calls === null ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : calls.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center text-sm text-gray-500">
          No calls in this window.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y">
          {calls.map(c => (
            <Link key={c.id} href={`/dashboard/receptionist/calls/${c.id}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${OUTCOME_LABEL[c.outcome].cls}`}>
                    {OUTCOME_LABEL[c.outcome].label}
                  </span>
                  <span className="font-medium text-gray-900">{c.from_number || 'Unknown caller'}</span>
                  <span className="text-xs text-gray-500">{new Date(c.created_at).toLocaleString()}</span>
                  {c.duration_seconds != null && (
                    <span className="text-xs text-gray-400">· {Math.round(c.duration_seconds / 60)}m</span>
                  )}
                </div>
                {c.summary && <div className="text-xs text-gray-500 mt-1 truncate">{c.summary}</div>}
              </div>
              <span className="text-gray-300 ml-3">›</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: 'red' | 'gray' }) {
  const cls = tone === 'red' && value !== 0 ? 'text-red-700' : 'text-gray-900'
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold ${cls}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
    </div>
  )
}
