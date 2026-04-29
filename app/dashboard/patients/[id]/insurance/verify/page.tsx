// app/dashboard/patients/[id]/insurance/verify/page.tsx
//
// W50 D6 — submit a Stedi 270/271 and surface the parsed coverage.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

interface Verification {
  id: string
  payer_name: string | null
  member_id: string | null
  group_number: string | null
  plan_name: string | null
  status: 'pending' | 'completed' | 'errored'
  parsed_summary: ParsedSummary | null
  requested_at: string
  completed_at: string | null
  expires_at: string
  error_message: string | null
  source: string
}

interface ParsedSummary {
  covered_services?: string[]
  copay_cents?: number | null
  deductible_total_cents?: number | null
  deductible_met_cents?: number | null
  out_of_pocket_max_cents?: number | null
  out_of_pocket_met_cents?: number | null
  prior_auth_required?: boolean | null
  plan_active?: boolean | null
  member_id_valid?: boolean | null
}

function dollars(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return `$${(cents / 100).toFixed(0)}`
}

export default function VerifyInsurancePage() {
  const params = useParams<{ id: string }>()
  const patientId = params.id
  const [list, setList] = useState<Verification[]>([])
  const [latest, setLatest] = useState<Verification | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const r = await fetch(`/api/ehr/patients/${patientId}/insurance/latest`)
    const j = await r.json()
    if (r.ok) { setList(j.verifications ?? []); setLatest(j.latest ?? null) }
    setLoading(false)
  }
  useEffect(() => { void load() }, [patientId])

  async function verify() {
    setError(null); setRunning(true)
    try {
      const r = await fetch(`/api/ehr/patients/${patientId}/insurance/verify`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'manual' }) })
      const j = await r.json()
      if (!r.ok) setError(j.message || j.error || 'Verification failed')
      else void load()
    } finally { setRunning(false) }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <Link href={`/dashboard/patients/${patientId}`} className="text-sm text-gray-500 hover:text-gray-700">← Back to patient</Link>
      <h1 className="text-2xl font-semibold text-gray-900 mt-2">Verify insurance coverage</h1>
      <p className="text-sm text-gray-500 mt-1">Submits a Stedi 270 against the patient's carrier and parses the 271 response.</p>

      <div className="mt-5 flex gap-2">
        <button onClick={verify} disabled={running}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
          {running ? 'Submitting…' : (latest ? 'Re-verify coverage' : 'Verify coverage')}
        </button>
      </div>

      {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="mt-6 text-sm text-gray-400">Loading…</div>
      ) : latest ? (
        <VerificationCard v={latest} highlight />
      ) : (
        <div className="mt-6 text-sm text-gray-500">No verifications yet for this patient.</div>
      )}

      {list.length > 1 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">History</h2>
          <div className="space-y-3">
            {list.slice(1).map(v => <VerificationCard key={v.id} v={v} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function VerificationCard({ v, highlight }: { v: Verification; highlight?: boolean }) {
  const s = v.parsed_summary ?? {}
  const status = v.status === 'completed' ? 'Completed'
               : v.status === 'errored' ? 'Errored'
               : 'Pending'
  const cls = v.status === 'completed' ? 'border-emerald-200 bg-emerald-50/50'
            : v.status === 'errored' ? 'border-red-200 bg-red-50/50'
            : 'border-yellow-200 bg-yellow-50/50'
  return (
    <div className={`border rounded-xl p-4 mt-4 ${highlight ? cls : 'border-gray-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-base font-semibold text-gray-900">{v.payer_name ?? 'Unknown carrier'}</div>
          <div className="text-xs text-gray-500">
            Member {v.member_id ?? '—'}{v.group_number ? ` · Group ${v.group_number}` : ''}
            {v.plan_name && ` · ${v.plan_name}`}
          </div>
        </div>
        <div className="text-right text-xs">
          <div className={`uppercase tracking-wide font-medium ${
            v.status === 'completed' ? 'text-emerald-700'
            : v.status === 'errored' ? 'text-red-700' : 'text-yellow-700'}`}>
            {status}
          </div>
          <div className="text-gray-400">Requested {new Date(v.requested_at).toLocaleDateString()}</div>
          <div className="text-gray-400">Expires {new Date(v.expires_at).toLocaleDateString()}</div>
        </div>
      </div>

      {v.status === 'errored' && v.error_message && (
        <div className="mt-3 text-sm text-red-700">{v.error_message}</div>
      )}

      {v.status === 'completed' && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Field label="Active" value={s.plan_active === false ? 'No' : s.plan_active ? 'Yes' : '—'} />
          <Field label="Member ID valid" value={s.member_id_valid === false ? 'No' : s.member_id_valid ? 'Yes' : '—'} />
          <Field label="Copay" value={dollars(s.copay_cents)} />
          <Field label="Prior auth" value={s.prior_auth_required ? 'Required' : s.prior_auth_required === false ? 'Not required' : '—'} />
          <Field label="Deductible met" value={`${dollars(s.deductible_met_cents)} / ${dollars(s.deductible_total_cents)}`} />
          <Field label="Out-of-pocket" value={`${dollars(s.out_of_pocket_met_cents)} / ${dollars(s.out_of_pocket_max_cents)}`} />
          <div className="col-span-2 sm:col-span-2">
            <div className="text-[10px] uppercase tracking-wide text-gray-500">Covered services</div>
            <div className="text-sm text-gray-900 flex flex-wrap gap-1 mt-1">
              {(s.covered_services ?? []).length === 0
                ? <span className="text-gray-400">—</span>
                : (s.covered_services ?? []).map(svc => (
                    <span key={svc} className="text-[11px] px-1.5 py-0.5 rounded border border-gray-300 bg-white">{svc}</span>
                  ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm text-gray-900">{value}</div>
    </div>
  )
}
