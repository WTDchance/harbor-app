// components/ehr/PreauthRequestsCard.tsx
//
// Wave 43 — patient-profile pre-authorization REQUESTS card.
// Shows active requests (draft/submitted/pending) plus recent decisions
// (approved/denied/expired/withdrawn). New-request inline form covers
// the common case (CPT + dx pickers + clinical justification + sessions).

'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, FileText, Send, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'

type PreauthRequest = {
  id: string
  payer_name: string
  payer_payer_id: string | null
  member_id: string
  cpt_codes: string[]
  diagnosis_codes: string[]
  requested_session_count: number
  requested_start_date: string
  requested_end_date: string | null
  clinical_justification: string
  status: 'draft' | 'submitted' | 'pending' | 'approved' | 'denied' | 'expired' | 'withdrawn'
  submitted_at: string | null
  submission_method: string | null
  payer_response_received_at: string | null
  resulting_authorization_id: string | null
  created_at: string
}

const STATUS_TONE: Record<PreauthRequest['status'], { label: string; bg: string; text: string; icon: any }> = {
  draft:     { label: 'Draft',     bg: 'bg-gray-100',   text: 'text-gray-700',  icon: FileText },
  submitted: { label: 'Submitted', bg: 'bg-blue-100',   text: 'text-blue-800',  icon: Send },
  pending:   { label: 'Pending',   bg: 'bg-amber-100',  text: 'text-amber-800', icon: Clock },
  approved:  { label: 'Approved',  bg: 'bg-green-100',  text: 'text-green-800', icon: CheckCircle2 },
  denied:    { label: 'Denied',    bg: 'bg-red-100',    text: 'text-red-800',   icon: XCircle },
  expired:   { label: 'Expired',   bg: 'bg-gray-100',   text: 'text-gray-700',  icon: AlertCircle },
  withdrawn: { label: 'Withdrawn', bg: 'bg-gray-100',   text: 'text-gray-700',  icon: XCircle },
}

export function PreauthRequestsCard({ patientId }: { patientId: string }) {
  const [rows, setRows] = useState<PreauthRequest[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const r = await fetch(`/api/ehr/patients/${patientId}/preauth-requests`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setRows(j.preauth_requests ?? [])
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load')
      setRows([])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() /* eslint-disable-line */ }, [patientId])

  const { active, recent } = useMemo(() => {
    const list = rows ?? []
    const active = list.filter(r => ['draft', 'submitted', 'pending'].includes(r.status))
    const recent = list.filter(r => !['draft', 'submitted', 'pending'].includes(r.status)).slice(0, 5)
    return { active, recent }
  }, [rows])

  if (loading) return <div className="text-sm text-gray-500">Loading pre-auth requests…</div>

  return (
    <div className="space-y-3">
      {err && <div className="text-sm text-red-600">{err}</div>}

      {/* Active */}
      <div>
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Active</div>
        {active.length === 0 ? (
          <div className="text-sm text-gray-500 italic">No active pre-auth requests.</div>
        ) : (
          <div className="space-y-2">
            {active.map(r => <RequestRow key={r.id} patientId={patientId} r={r} />)}
          </div>
        )}
      </div>

      {/* Recent decisions */}
      {recent.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Recent decisions</div>
          <div className="space-y-2">
            {recent.map(r => <RequestRow key={r.id} patientId={patientId} r={r} />)}
          </div>
        </div>
      )}

      {/* New */}
      {showNew ? (
        <NewRequestForm
          patientId={patientId}
          onCancel={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load() }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="text-sm text-blue-600 hover:text-blue-800 underline inline-flex items-center gap-1"
          style={{ minHeight: 32 }}
        >
          <Plus className="w-3 h-3" /> New pre-auth request
        </button>
      )}
    </div>
  )
}

function RequestRow({ patientId, r }: { patientId: string; r: PreauthRequest }) {
  const tone = STATUS_TONE[r.status]
  const Icon = tone.icon
  return (
    <Link
      href={`/dashboard/patients/${patientId}/preauth-requests/${r.id}`}
      className="block border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900 truncate">
            {r.payer_name}
            <span className="text-gray-500 font-normal"> · {r.requested_session_count} sessions</span>
          </div>
          <div className="text-xs text-gray-500 truncate">
            CPT: {(r.cpt_codes || []).join(', ') || '—'} · Dx: {(r.diagnosis_codes || []).join(', ') || '—'}
          </div>
        </div>
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${tone.bg} ${tone.text}`}>
          <Icon className="w-3 h-3" />{tone.label}
        </span>
      </div>
    </Link>
  )
}

function NewRequestForm({
  patientId, onCancel, onCreated,
}: { patientId: string; onCancel: () => void; onCreated: () => void }) {
  const [payerName, setPayerName] = useState('')
  const [memberId, setMemberId] = useState('')
  const [cptInput, setCptInput] = useState('')
  const [dxInput, setDxInput] = useState('')
  const [sessionCount, setSessionCount] = useState<number | ''>(20)
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState('')
  const [justification, setJustification] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(ev: React.FormEvent) {
    ev.preventDefault()
    setErr(null)
    const cpts = cptInput.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
    const dxs = dxInput.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
    if (!payerName || !memberId || cpts.length === 0 || dxs.length === 0 || !sessionCount || !startDate || !justification) {
      setErr('All fields except end date are required.')
      return
    }
    setSaving(true)
    try {
      const r = await fetch(`/api/ehr/patients/${patientId}/preauth-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payer_name: payerName,
          member_id: memberId,
          cpt_codes: cpts,
          diagnosis_codes: dxs,
          requested_session_count: Number(sessionCount),
          requested_start_date: startDate,
          requested_end_date: endDate || null,
          clinical_justification: justification,
        }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => null)
        throw new Error(j?.error?.message || `HTTP ${r.status}`)
      }
      onCreated()
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to create')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="border border-blue-200 bg-blue-50/50 rounded-lg p-3 space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Field label="Payer">
          <input
            type="text"
            value={payerName}
            onChange={e => setPayerName(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            placeholder="e.g. Blue Shield of California"
          />
        </Field>
        <Field label="Member ID">
          <input
            type="text"
            value={memberId}
            onChange={e => setMemberId(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </Field>
        <Field label="CPT codes (comma/space separated)">
          <input
            type="text"
            value={cptInput}
            onChange={e => setCptInput(e.target.value)}
            placeholder="90837, 90834"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono"
          />
        </Field>
        <Field label="Diagnosis codes (ICD-10)">
          <input
            type="text"
            value={dxInput}
            onChange={e => setDxInput(e.target.value)}
            placeholder="F33.1, F41.1"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono"
          />
        </Field>
        <Field label="Sessions requested">
          <input
            type="number"
            min={1}
            value={sessionCount}
            onChange={e => setSessionCount(e.target.value === '' ? '' : Number(e.target.value))}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </Field>
        <Field label="Date span">
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm flex-1"
            />
            <span className="text-xs text-gray-500">→</span>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              placeholder="open-ended"
              className="border border-gray-300 rounded px-2 py-1 text-sm flex-1"
            />
          </div>
        </Field>
      </div>
      <Field label="Clinical justification">
        <textarea
          value={justification}
          onChange={e => setJustification(e.target.value)}
          rows={4}
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          placeholder="Medical necessity, prior treatment response, target symptoms, expected outcomes…"
        />
      </Field>
      {err && <div className="text-sm text-red-600">{err}</div>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="text-sm bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1.5 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Create draft'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-gray-600 hover:text-gray-800 px-2"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      {children}
    </label>
  )
}
