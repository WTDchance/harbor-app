'use client'

// Wave 41 / T1 — patient-facing accounting of disclosures (§164.528).
// List + create form. Update is via the API; UI for editing one row
// is a small follow-up. PDF export uses the date-range query string.

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Download, ShieldAlert, Calendar, X } from 'lucide-react'

const KINDS: Array<{ value: string; label: string }> = [
  { value: 'roi_authorization',  label: 'ROI authorization' },
  { value: 'court_order',        label: 'Court order / subpoena' },
  { value: 'public_health',      label: 'Mandatory public-health report' },
  { value: 'law_enforcement',    label: 'Law enforcement request' },
  { value: 'workers_comp',       label: 'Workers comp' },
  { value: 'coroner_or_funeral', label: 'Coroner / funeral' },
  { value: 'research',           label: 'IRB-approved research' },
  { value: 'oversight_agency',   label: 'HHS / oversight agency' },
  { value: 'tarasoff_warning',   label: 'Tarasoff / duty to warn' },
  { value: 'other',              label: 'Other' },
]

interface Disclosure {
  id: string
  disclosed_at: string
  disclosure_kind: string
  recipient_name: string
  recipient_address: string | null
  purpose: string
  description_of_phi: string
  legal_authority: string | null
  is_part2_protected: boolean
  included_in_accounting: boolean
  notes: string | null
  disclosed_by_name: string | null
}

export default function DisclosuresPage() {
  const params = useParams()
  const patientId = String(params.id)

  const [rows, setRows] = useState<Disclosure[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state.
  const [kind, setKind] = useState('roi_authorization')
  const [recipient, setRecipient] = useState('')
  const [recipientAddress, setRecipientAddress] = useState('')
  const [purpose, setPurpose] = useState('')
  const [description, setDescription] = useState('')
  const [legalAuthority, setLegalAuthority] = useState('')
  const [isPart2, setIsPart2] = useState(false)
  const [includedInAccounting, setIncludedInAccounting] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/ehr/patients/${patientId}/disclosures`, { credentials: 'include' })
      if (!res.ok) { setRows([]); return }
      const data = await res.json()
      setRows(Array.isArray(data?.disclosures) ? data.disclosures : [])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [patientId])

  function resetForm() {
    setKind('roi_authorization'); setRecipient(''); setRecipientAddress('')
    setPurpose(''); setDescription(''); setLegalAuthority('')
    setIsPart2(false); setIncludedInAccounting(true); setError(null)
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/ehr/patients/${patientId}/disclosures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          disclosure_kind: kind,
          recipient_name: recipient,
          recipient_address: recipientAddress || null,
          purpose,
          description_of_phi: description,
          legal_authority: legalAuthority || null,
          is_part2_protected: isPart2,
          included_in_accounting: includedInAccounting,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error?.message || `Create failed (${res.status})`)
        return
      }
      setShowForm(false); resetForm(); await load()
    } catch (err: any) {
      setError(err?.message || 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  function downloadAccounting() {
    // Default to last 6 years per §164.528.
    window.location.href = `/api/ehr/patients/${patientId}/disclosures/accounting`
  }

  return (
    <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
      <Link
        href={`/dashboard/patients/${patientId}`}
        className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-800"
        style={{ minHeight: 44 }}
      >
        <ArrowLeft className="w-4 h-4" /> Back to patient
      </Link>

      <div className="flex items-center justify-between mt-3 mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Accounting of disclosures</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            HIPAA §164.528 — every disclosure of PHI to a third party that wasn't for treatment, payment, healthcare ops, or via patient authorization.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={downloadAccounting}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
            style={{ minHeight: 44 }}
          >
            <Download className="w-4 h-4" /> Generate PDF
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700"
            style={{ minHeight: 44 }}
          >
            <Plus className="w-4 h-4" /> Record disclosure
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          No disclosures recorded for this patient.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div>
                  <span className="text-sm font-semibold text-gray-900">
                    <Calendar className="w-3.5 h-3.5 inline mr-1 text-gray-400" />
                    {new Date(r.disclosed_at).toLocaleDateString()}
                  </span>
                  <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                    {KINDS.find((k) => k.value === r.disclosure_kind)?.label ?? r.disclosure_kind}
                  </span>
                  {r.is_part2_protected && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800">
                      <ShieldAlert className="w-3 h-3" /> 42 CFR Part 2
                    </span>
                  )}
                  {!r.included_in_accounting && (
                    <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Excluded from accounting</span>
                  )}
                </div>
                {r.disclosed_by_name && (
                  <span className="text-xs text-gray-500">by {r.disclosed_by_name}</span>
                )}
              </div>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                <div><span className="text-xs text-gray-500 block">Recipient</span>{r.recipient_name}{r.recipient_address && <span className="block text-gray-500 text-xs">{r.recipient_address}</span>}</div>
                <div><span className="text-xs text-gray-500 block">Purpose</span>{r.purpose}</div>
                <div className="md:col-span-2"><span className="text-xs text-gray-500 block">PHI disclosed</span>{r.description_of_phi}</div>
                {r.legal_authority && <div className="md:col-span-2"><span className="text-xs text-gray-500 block">Legal authority</span>{r.legal_authority}</div>}
                {r.notes && <div className="md:col-span-2 text-xs text-gray-500">{r.notes}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Record disclosure</h2>
              <button onClick={() => { setShowForm(false); resetForm() }}
                      className="text-gray-400 hover:text-gray-600" style={{ minHeight: 44, minWidth: 44 }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <Field label="Disclosure kind" required>
                <select value={kind} onChange={(e) => setKind(e.target.value)}
                        className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }}>
                  {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </Field>
              <Field label="Recipient name" required>
                <input value={recipient} onChange={(e) => setRecipient(e.target.value)}
                       className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
              </Field>
              <Field label="Recipient address">
                <input value={recipientAddress} onChange={(e) => setRecipientAddress(e.target.value)}
                       className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
              </Field>
              <Field label="Purpose" required>
                <textarea rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)}
                          className="w-full p-2 text-sm border border-gray-200 rounded-lg" />
              </Field>
              <Field label="Description of PHI disclosed" required>
                <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
                          className="w-full p-2 text-sm border border-gray-200 rounded-lg" />
              </Field>
              <Field label="Legal authority (citation, court order #, etc.)">
                <input value={legalAuthority} onChange={(e) => setLegalAuthority(e.target.value)}
                       className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
              </Field>
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ minHeight: 44 }}>
                <input type="checkbox" checked={isPart2} onChange={(e) => setIsPart2(e.target.checked)} />
                <span>42 CFR Part 2 protected (re-disclosure prohibition applies)</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ minHeight: 44 }}>
                <input type="checkbox" checked={includedInAccounting} onChange={(e) => setIncludedInAccounting(e.target.checked)} />
                <span>Include in patient's §164.528 accounting</span>
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button onClick={() => { setShowForm(false); resetForm() }}
                      className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
                      style={{ minHeight: 44 }}>Cancel</button>
              <button onClick={submit} disabled={submitting || !recipient || !purpose || !description}
                      className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-60"
                      style={{ minHeight: 44 }}>
                {submitting ? 'Recording…' : 'Record'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
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
