// app/dashboard/ehr/billing/page.tsx
// Practice-wide billing dashboard. Top stat row (AR aging buckets) +
// filterable charge list. Claim submission is Week-5 — this page
// documents the pipeline and lets the admin manage charges.

'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { DollarSign, Filter, SendHorizonal } from 'lucide-react'

type Charge = {
  id: string; patient_id: string; cpt_code: string; units: number
  fee_cents: number; allowed_cents: number; billed_to: string; status: string
  service_date: string; created_at: string
}

const STATUSES = ['pending', 'submitted', 'partial', 'paid', 'denied', 'written_off', 'void']

function cents(n: number): string { return `$${(n / 100).toFixed(2)}` }

function ageDays(date: string): number {
  const ms = Date.now() - new Date(date).getTime()
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

export default function BillingPage() {
  const [charges, setCharges] = useState<Charge[] | null>(null)
  const [patients, setPatients] = useState<Map<string, { first_name: string; last_name: string }>>(new Map())
  const [filter, setFilter] = useState<string>('pending')
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<string | null>(null)

  async function reload() {
    const res = await fetch(`/api/ehr/billing/charges?limit=500`)
    if (res.ok) {
      const json = await res.json()
      setCharges(json.charges || [])
    }
  }

  async function submitAllPendingClaims() {
    if (!charges) return
    const toSubmit = charges.filter((c) => c.status === 'pending' && (c.billed_to === 'insurance' || c.billed_to === 'both'))
    if (toSubmit.length === 0) { setSubmitResult('No pending insurance-billable charges to submit.'); return }
    if (!confirm(`Submit ${toSubmit.length} charge${toSubmit.length === 1 ? '' : 's'} to insurance?`)) return
    setSubmitting(true); setSubmitResult(null)
    try {
      const res = await fetch('/api/ehr/billing/claims/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ charge_ids: toSubmit.map((c) => c.id) }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      const submitted = json.results.filter((r: any) => r.status === 'submitted').length
      const rejected = json.results.filter((r: any) => r.status === 'rejected').length
      const errored = json.results.filter((r: any) => r.status === 'error').length
      setSubmitResult(`${submitted} submitted · ${rejected} rejected · ${errored} error`)
      await reload()
    } catch (err) {
      setSubmitResult(err instanceof Error ? err.message : 'Failed')
    } finally { setSubmitting(false) }
  }

  useEffect(() => {
    (async () => {
      await reload()
      // Best-effort fetch of patients for display. Harbor has an admin
      // route; fall back to empty map if not available in this env.
      try {
        const pr = await fetch('/api/practice/me')
        if (pr.ok) {
          const p = await pr.json()
          const r = await fetch(`/api/admin/patients?practice_id=${p.practice?.id}`)
          if (r.ok) {
            const j = await r.json()
            const m = new Map<string, any>()
            for (const pt of j.patients || []) m.set(pt.id, { first_name: pt.first_name, last_name: pt.last_name })
            setPatients(m)
          }
        }
      } catch {}
    })()
  }, [])

  const filtered = useMemo(() => {
    if (!charges) return []
    if (filter === 'all') return charges
    return charges.filter((c) => c.status === filter)
  }, [charges, filter])

  const stats = useMemo(() => {
    if (!charges) return null
    let pending = 0, submitted = 0, paid = 0, denied = 0
    const ageBuckets = { b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0 }
    let arUnpaid = 0
    for (const c of charges) {
      if (c.status === 'void') continue
      if (c.status === 'pending') pending += Number(c.allowed_cents)
      if (c.status === 'submitted') submitted += Number(c.allowed_cents)
      if (c.status === 'paid') paid += Number(c.allowed_cents)
      if (c.status === 'denied') denied += Number(c.allowed_cents)
      if (['pending', 'submitted', 'partial', 'denied'].includes(c.status)) {
        arUnpaid += Number(c.allowed_cents)
        const days = ageDays(c.service_date)
        if (days <= 30) ageBuckets.b0_30 += Number(c.allowed_cents)
        else if (days <= 60) ageBuckets.b31_60 += Number(c.allowed_cents)
        else if (days <= 90) ageBuckets.b61_90 += Number(c.allowed_cents)
        else ageBuckets.b90_plus += Number(c.allowed_cents)
      }
    }
    return { pending, submitted, paid, denied, ageBuckets, arUnpaid, count: charges.length }
  }, [charges])

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <DollarSign className="w-6 h-6 text-teal-600" />
          Billing
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Charges auto-create when a note is signed with CPT codes. This is where you turn them into claims,
          track aging, record payments, and generate superbills.
        </p>
      </div>

      {stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Unpaid AR" value={cents(stats.arUnpaid)} accent={stats.arUnpaid > 0 ? 'amber' : 'green'} />
            <Stat label="Pending charges" value={cents(stats.pending)} hint={`${charges?.filter(c => c.status === 'pending').length || 0} items`} />
            <Stat label="Submitted" value={cents(stats.submitted)} />
            <Stat label="Paid" value={cents(stats.paid)} accent="green" />
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="font-semibold text-gray-900 mb-3">Aging accounts receivable</h2>
            <div className="grid grid-cols-4 gap-3">
              <Stat label="0–30 days" value={cents(stats.ageBuckets.b0_30)} />
              <Stat label="31–60 days" value={cents(stats.ageBuckets.b31_60)} accent={stats.ageBuckets.b31_60 > 0 ? 'amber' : undefined} />
              <Stat label="61–90 days" value={cents(stats.ageBuckets.b61_90)} accent={stats.ageBuckets.b61_90 > 0 ? 'amber' : undefined} />
              <Stat label="90+ days" value={cents(stats.ageBuckets.b90_plus)} accent={stats.ageBuckets.b90_plus > 0 ? 'red' : undefined} />
            </div>
          </div>
        </>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 flex-wrap">
          <Filter className="w-4 h-4 text-gray-400" />
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1 text-sm">
            <option value="all">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="text-xs text-gray-500">{filtered.length} charges</div>
          {filter === 'pending' && (
            <button
              type="button"
              onClick={submitAllPendingClaims}
              disabled={submitting || !charges || charges.filter(c => c.status === 'pending' && (c.billed_to === 'insurance' || c.billed_to === 'both')).length === 0}
              className="ml-auto inline-flex items-center gap-2 text-xs bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-md disabled:opacity-50"
            >
              <SendHorizonal className="w-3.5 h-3.5" />
              {submitting ? 'Submitting…' : 'Submit pending claims (Stedi)'}
            </button>
          )}
          {submitResult && (
            <div className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-md px-2 py-1 ml-2">
              {submitResult}
            </div>
          )}
        </div>
        {!charges ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <DollarSign className="w-10 h-10 mx-auto text-gray-300 mb-3" />
            <p className="text-sm text-gray-500">No charges in this view.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Date</th>
                <th className="text-left px-4 py-2">Patient</th>
                <th className="text-left px-4 py-2">CPT</th>
                <th className="text-left px-4 py-2">Billed to</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-right px-4 py-2">Amount</th>
                <th className="text-right px-4 py-2">Age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((c) => {
                const pt = patients.get(c.patient_id)
                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">{new Date(c.service_date).toLocaleDateString()}</td>
                    <td className="px-4 py-2 text-xs">
                      {pt ? (
                        <Link href={`/dashboard/patients/${c.patient_id}`} className="text-teal-700 hover:text-teal-900">
                          {pt.first_name} {pt.last_name}
                        </Link>
                      ) : <span className="font-mono text-gray-400">{c.patient_id.slice(0, 8)}</span>}
                    </td>
                    <td className="px-4 py-2 text-xs font-mono font-semibold text-teal-700">{c.cpt_code}</td>
                    <td className="px-4 py-2 text-xs text-gray-600">{c.billed_to.replace('_', ' ')}</td>
                    <td className="px-4 py-2 text-xs">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                        c.status === 'paid' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : c.status === 'denied' ? 'bg-red-50 text-red-800 border-red-200'
                        : c.status === 'submitted' ? 'bg-blue-50 text-blue-800 border-blue-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}>{c.status}</span>
                    </td>
                    <td className="px-4 py-2 text-xs font-mono text-right">{cents(c.allowed_cents)}</td>
                    <td className="px-4 py-2 text-xs text-right text-gray-500">{ageDays(c.service_date)}d</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Claim submission to insurance via Stedi 837 EDI is implemented but disabled by default in sandbox mode.
        When you're ready to test, flip <code className="text-xs bg-gray-100 px-1 rounded">practices.stedi_mode</code>
        to <strong>sandbox</strong>, then to <strong>production</strong> after your first successful round-trip.
      </p>
    </div>
  )
}

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: 'green' | 'amber' | 'red' }) {
  const cls = accent === 'green' ? 'text-emerald-700' : accent === 'amber' ? 'text-amber-700' : accent === 'red' ? 'text-red-700' : 'text-gray-900'
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-xs uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`text-xl font-bold font-mono mt-1 ${cls}`}>{value}</div>
      {hint && <div className="text-[11px] text-gray-500 mt-0.5">{hint}</div>}
    </div>
  )
}
