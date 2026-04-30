// app/dashboard/billing/era-queue/page.tsx
//
// W52 D4 — ERA reconciliation queue (new W52 era_remittances table).
// Distinct from the legacy /dashboard/billing/reconciliation page which
// reports W44 totals against the W41 ehr_era_files surface; this is the
// auto-match queue with manual-match + dispute affordances.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Remittance {
  id: string; payer_name: string | null; payment_amount_cents: number;
  payment_date: string | null; status: string; received_at: string;
  line_count: number; matched_count: number;
}

const STATUS_CLS: Record<string, string> = {
  unmatched: 'bg-amber-50 border-amber-300 text-amber-700',
  partially_matched: 'bg-blue-50 border-blue-300 text-blue-700',
  fully_matched: 'bg-emerald-50 border-emerald-300 text-emerald-700',
  disputed: 'bg-red-50 border-red-300 text-red-700',
}

function dollars(c: number): string { return `$${(c / 100).toFixed(2)}` }

export default function EraQueuePage() {
  const [list, setList] = useState<Remittance[] | null>(null)
  const [filter, setFilter] = useState<string>('all')

  async function load() {
    const sp = new URLSearchParams()
    if (filter !== 'all') sp.set('status', filter)
    const r = await fetch(`/api/ehr/era?${sp}`)
    const j = await r.json(); if (r.ok) setList(j.remittances ?? [])
  }
  useEffect(() => { void load() }, [filter])

  const totals = list?.reduce((acc, r) => {
    acc.total += 1
    acc.matched += r.line_count > 0 && r.matched_count === r.line_count ? 1 : 0
    return acc
  }, { total: 0, matched: 0 })
  const autoRate = totals && totals.total > 0 ? Math.round((totals.matched / totals.total) * 100) : 0

  return (
    <div className="max-w-5xl mx-auto p-6">
      <Link href="/dashboard/billing/reconciliation" className="text-sm text-gray-500 hover:text-gray-700">← Reconciliation totals</Link>
      <h1 className="text-2xl font-semibold text-gray-900 mt-2">ERA queue</h1>
      <p className="text-sm text-gray-500 mt-1">Insurance remittances (835) auto-matched against your submitted claims.</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Total remittances</div>
          <div className="text-2xl font-semibold">{totals?.total ?? 0}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Auto-match rate</div>
          <div className="text-2xl font-semibold">{autoRate}%</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Filter</div>
          <select value={filter} onChange={e => setFilter(e.target.value)}
            className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="all">All</option>
            <option value="unmatched">Unmatched</option>
            <option value="partially_matched">Partial</option>
            <option value="fully_matched">Fully matched</option>
            <option value="disputed">Disputed</option>
          </select>
        </div>
      </div>

      {list === null ? <div className="mt-6 text-sm text-gray-400">Loading…</div> :
       list.length === 0 ? (
        <div className="mt-6 bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center text-sm text-gray-500">
          No remittances yet. They'll appear here as Stedi 835s arrive.
        </div>
       ) : (
        <div className="mt-6 bg-white border border-gray-200 rounded-xl divide-y">
          {list.map(r => (
            <div key={r.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900">{r.payer_name ?? 'Unknown payer'}</span>
                  <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${STATUS_CLS[r.status] ?? STATUS_CLS.unmatched}`}>
                    {r.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {dollars(r.payment_amount_cents)} · {r.payment_date ?? '—'} · {r.matched_count}/{r.line_count} lines matched
                </div>
              </div>
              <div className="text-xs text-gray-400">{new Date(r.received_at).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
