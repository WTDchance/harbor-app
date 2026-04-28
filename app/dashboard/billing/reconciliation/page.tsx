// app/dashboard/billing/reconciliation/page.tsx
//
// W44 T2 — practice billing reconciliation report.

'use client'

import { useEffect, useState } from 'react'

type Totals = {
  total_billed_cents: number
  total_insurance_paid_cents: number
  total_patient_paid_cents: number
  total_adjusted_off_cents: number
  total_denied_cents: number
  outstanding_cents: number
  outstanding_count: number
}

type ByTherapist = {
  therapist_id: string | null
  therapist_name: string
  billed_cents: number
  charge_count: number
}

type ByPayer = {
  payer_name: string
  billed_cents: number
  paid_cents: number
  adjusted_off_cents: number
  denied_count: number
  denied_cents: number
  line_count: number
  avg_days_in_ar: number | null
}

type DenialReason = {
  code: string
  reason_text: string | null
  count: number
  total_cents: number
}

function fmtUsd(cents: number): string {
  return ((cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function firstOfMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

export default function BillingReconciliationPage() {
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [data, setData] = useState<{
    totals: Totals
    by_therapist: ByTherapist[]
    by_payer: ByPayer[]
    top_denial_reasons: DenialReason[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ehr/billing/reconciliation?from=${from}&to=${to}`)
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      setData(await res.json())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [from, to])

  function exportCsv() {
    const url = `/api/ehr/billing/reconciliation?from=${from}&to=${to}&format=csv`
    window.location.href = url
  }

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Billing reconciliation</h1>
          <p className="text-sm text-gray-600 mt-1">
            Total billed, paid, adjusted off, denied, and outstanding
            for the period — broken down by therapist and by payer.
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={loading}
          className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      <div className="flex items-end gap-3">
        <label className="text-sm">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block border rounded px-2 py-1 mt-1" />
        </label>
        <label className="text-sm">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block border rounded px-2 py-1 mt-1" />
        </label>
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !data ? null : (
        <>
          {/* Totals strip */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Total billed"          value={fmtUsd(data.totals.total_billed_cents)} />
            <Stat label="Insurance paid"        value={fmtUsd(data.totals.total_insurance_paid_cents)} />
            <Stat label="Patient paid"          value={fmtUsd(data.totals.total_patient_paid_cents)} />
            <Stat label="Adjusted off"          value={fmtUsd(data.totals.total_adjusted_off_cents)} />
            <Stat label="Denied"                value={fmtUsd(data.totals.total_denied_cents)} tone="red" />
            <Stat label="Outstanding"           value={fmtUsd(data.totals.outstanding_cents)}
                  sub={`${data.totals.outstanding_count} charges`} />
          </section>

          {/* By payer */}
          <section className="bg-white rounded border overflow-x-auto">
            <h2 className="text-lg font-medium px-3 py-2 border-b">By payer</h2>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2">Payer</th>
                  <th className="text-right px-3 py-2">Billed</th>
                  <th className="text-right px-3 py-2">Paid</th>
                  <th className="text-right px-3 py-2">Adjusted off</th>
                  <th className="text-right px-3 py-2">Denied</th>
                  <th className="text-right px-3 py-2">Days in AR</th>
                </tr>
              </thead>
              <tbody>
                {data.by_payer.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-3 text-gray-500">No ERA payments in this range.</td></tr>
                ) : data.by_payer.map((r) => (
                  <tr key={r.payer_name} className="border-t">
                    <td className="px-3 py-2">{r.payer_name}</td>
                    <td className="px-3 py-2 text-right">{fmtUsd(r.billed_cents)}</td>
                    <td className="px-3 py-2 text-right">{fmtUsd(r.paid_cents)}</td>
                    <td className="px-3 py-2 text-right">{fmtUsd(r.adjusted_off_cents)}</td>
                    <td className="px-3 py-2 text-right">
                      {r.denied_count > 0 ? `${fmtUsd(r.denied_cents)} (${r.denied_count})` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.avg_days_in_ar != null ? `${Number(r.avg_days_in_ar).toFixed(1)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* By therapist */}
          <section className="bg-white rounded border overflow-x-auto">
            <h2 className="text-lg font-medium px-3 py-2 border-b">By therapist</h2>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2">Therapist</th>
                  <th className="text-right px-3 py-2">Charges</th>
                  <th className="text-right px-3 py-2">Billed</th>
                </tr>
              </thead>
              <tbody>
                {data.by_therapist.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-3 text-gray-500">No charges in this range.</td></tr>
                ) : data.by_therapist.map((r) => (
                  <tr key={r.therapist_id || 'unassigned'} className="border-t">
                    <td className="px-3 py-2">{r.therapist_name}</td>
                    <td className="px-3 py-2 text-right">{r.charge_count}</td>
                    <td className="px-3 py-2 text-right">{fmtUsd(r.billed_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Denial reasons */}
          <section className="bg-white rounded border overflow-x-auto">
            <h2 className="text-lg font-medium px-3 py-2 border-b">Top denial reasons</h2>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2">Code</th>
                  <th className="text-left px-3 py-2">Reason</th>
                  <th className="text-right px-3 py-2">Count</th>
                  <th className="text-right px-3 py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.top_denial_reasons.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-3 text-gray-500">No denials in this range.</td></tr>
                ) : data.top_denial_reasons.map((r, i) => (
                  <tr key={`${r.code}-${i}`} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                    <td className="px-3 py-2">{r.reason_text || '—'}</td>
                    <td className="px-3 py-2 text-right">{r.count}</td>
                    <td className="px-3 py-2 text-right">{fmtUsd(r.total_cents)}</td>
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

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'red' | 'gray' }) {
  const color = tone === 'red' ? 'text-red-600' : 'text-gray-900'
  return (
    <div className="rounded border bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}
