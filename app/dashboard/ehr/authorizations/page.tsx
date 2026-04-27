'use client'

// Wave 40 / P1 — Insurance authorizations list + create.
//
// Practice-scoped. Filterable by status. The "+ New" form creates
// one auth at a time. Per-row status pill (active / low / exhausted
// / expired) computed client-side from sessions_used + valid_to.

import { useEffect, useState } from 'react'
import { Plus, X, AlertTriangle, CheckCircle, Clock } from 'lucide-react'

interface AuthRow {
  id: string
  patient_id: string
  payer: string
  auth_number: string
  sessions_authorized: number
  sessions_used: number
  valid_from: string | null
  valid_to: string | null
  cpt_codes_covered: string[]
  notes: string | null
  status: 'active' | 'expired' | 'exhausted' | 'superseded'
  created_at: string
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'exhausted', label: 'Exhausted' },
  { value: 'superseded', label: 'Superseded' },
]

export default function AuthorizationsPage() {
  const [rows, setRows] = useState<AuthRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state.
  const [patientId, setPatientId] = useState('')
  const [payer, setPayer] = useState('')
  const [authNumber, setAuthNumber] = useState('')
  const [sessionsAuthorized, setSessionsAuthorized] = useState('12')
  const [validFrom, setValidFrom] = useState('')
  const [validTo, setValidTo] = useState('')
  const [cptCodes, setCptCodes] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ''
      const res = await fetch(`/api/ehr/insurance-authorizations${qs}`, { credentials: 'include' })
      if (!res.ok) {
        setRows([])
        return
      }
      const data = await res.json()
      setRows(Array.isArray(data?.authorizations) ? data.authorizations : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [statusFilter])

  function resetForm() {
    setPatientId(''); setPayer(''); setAuthNumber('')
    setSessionsAuthorized('12'); setValidFrom(''); setValidTo('')
    setCptCodes(''); setNotes(''); setError(null)
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const cpts = cptCodes.split(',').map((s) => s.trim()).filter(Boolean)
      const body: Record<string, unknown> = {
        patient_id: patientId,
        payer,
        auth_number: authNumber,
        sessions_authorized: Number(sessionsAuthorized),
        cpt_codes_covered: cpts,
      }
      if (validFrom) body.valid_from = validFrom
      if (validTo) body.valid_to = validTo
      if (notes) body.notes = notes
      const res = await fetch('/api/ehr/insurance-authorizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error?.message || `Create failed (${res.status})`)
        return
      }
      setShowForm(false)
      resetForm()
      await load()
    } catch (err: any) {
      setError(err?.message || 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Insurance authorizations</h1>
          <p className="text-sm text-gray-500 mt-0.5">Pre-authorizations gating commercial-insurance billing.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700"
          style={{ minHeight: 44 }}
        >
          <Plus className="w-4 h-4" />
          New auth
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4 overflow-x-auto -mx-2 px-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-full border ${
              statusFilter === s.value
                ? 'bg-teal-600 text-white border-teal-600'
                : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
            }`}
            style={{ minHeight: 32 }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          No authorizations yet. Tap "New auth" to add one.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Payer + #</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Sessions</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Valid window</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">CPTs</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <Row key={r.id} r={r} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">New authorization</h2>
              <button
                onClick={() => { setShowForm(false); resetForm() }}
                className="text-gray-400 hover:text-gray-600"
                style={{ minHeight: 44, minWidth: 44 }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <Field label="Patient ID" required>
                <input value={patientId} onChange={(e) => setPatientId(e.target.value)}
                       placeholder="UUID of the patient"
                       className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
              </Field>
              <Field label="Payer" required>
                <input value={payer} onChange={(e) => setPayer(e.target.value)}
                       placeholder="e.g. Blue Cross Blue Shield"
                       className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
              </Field>
              <Field label="Auth number" required>
                <input value={authNumber} onChange={(e) => setAuthNumber(e.target.value)}
                       className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
              </Field>
              <Field label="Sessions authorized" required>
                <input type="number" min="0" value={sessionsAuthorized}
                       onChange={(e) => setSessionsAuthorized(e.target.value)}
                       className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Valid from">
                  <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)}
                         className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
                </Field>
                <Field label="Valid to">
                  <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)}
                         className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
                </Field>
              </div>
              <Field label="CPT codes covered (comma-separated)">
                <input value={cptCodes} onChange={(e) => setCptCodes(e.target.value)}
                       placeholder="90834, 90837"
                       className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
                <p className="text-xs text-gray-500 mt-1">Leave empty to cover all CPTs (rare).</p>
              </Field>
              <Field label="Notes">
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                          rows={2}
                          className="w-full p-2 text-sm border border-gray-200 rounded-lg" />
              </Field>
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button onClick={() => { setShowForm(false); resetForm() }}
                      className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
                      style={{ minHeight: 44 }}>Cancel</button>
              <button onClick={submit} disabled={submitting || !patientId || !payer || !authNumber}
                      className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-60"
                      style={{ minHeight: 44 }}>
                {submitting ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function Row({ r }: { r: AuthRow }) {
  const remaining = r.sessions_authorized - r.sessions_used
  const today = new Date().toISOString().slice(0, 10)
  const expired = r.valid_to ? r.valid_to < today : false
  const computedStatus =
    r.status === 'superseded' ? 'superseded' :
    expired                   ? 'expired'    :
    r.status === 'exhausted'  ? 'exhausted'  :
    remaining <= 2            ? 'low'        : 'active'

  return (
    <tr>
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900">{r.payer}</div>
        <code className="text-xs text-gray-500">{r.auth_number}</code>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className={remaining <= 2 ? 'text-amber-700 font-medium' : 'text-gray-900'}>
          {r.sessions_used} / {r.sessions_authorized}
        </span>
        <div className="text-xs text-gray-500">{remaining} remaining</div>
      </td>
      <td className="px-4 py-3 text-gray-600 text-xs">
        {r.valid_from ?? '—'} → {r.valid_to ?? '—'}
      </td>
      <td className="px-4 py-3 text-xs text-gray-600">
        {r.cpt_codes_covered.length === 0 ? <em>any</em> : r.cpt_codes_covered.join(', ')}
      </td>
      <td className="px-4 py-3"><StatusPill kind={computedStatus} /></td>
    </tr>
  )
}

function StatusPill({ kind }: { kind: string }) {
  const map: Record<string, { label: string; cls: string; Icon: any }> = {
    active:     { label: 'Active',     cls: 'bg-green-100 text-green-800',   Icon: CheckCircle },
    low:        { label: 'Low',        cls: 'bg-amber-100 text-amber-800',   Icon: AlertTriangle },
    expired:    { label: 'Expired',    cls: 'bg-red-100 text-red-800',       Icon: Clock },
    exhausted:  { label: 'Exhausted',  cls: 'bg-red-100 text-red-800',       Icon: AlertTriangle },
    superseded: { label: 'Superseded', cls: 'bg-gray-100 text-gray-700',     Icon: Clock },
  }
  const s = map[kind] ?? map.active
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>
      <s.Icon className="w-3 h-3" />
      {s.label}
    </span>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: any }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-600 ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}
