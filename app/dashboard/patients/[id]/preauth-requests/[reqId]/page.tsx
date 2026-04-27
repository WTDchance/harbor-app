"use client"

// app/dashboard/patients/[id]/preauth-requests/[reqId]/page.tsx
//
// Wave 43 — full pre-authorization request detail page.
//   * View: full request fields + payer response if recorded
//   * Submit: choose method, enter reference, click → downloads PDF + flips
//             status to 'submitted'
//   * Record response: pending/approved/denied/expired + summary; on
//                      approved also captures auth_number + sessions for
//                      the W40 row that gets auto-spawned server-side
//   * Withdraw: any open status -> withdrawn with optional reason

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Download, RefreshCw } from 'lucide-react'

type PreauthRequest = {
  id: string
  patient_id: string
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
  submission_reference: string | null
  payer_response_received_at: string | null
  payer_response_summary: string | null
  resulting_authorization_id: string | null
  created_at: string
  updated_at: string
}

export default function PreauthRequestPage() {
  const params = useParams<{ id: string; reqId: string }>()
  const router = useRouter()
  const patientId = params?.id as string
  const reqId = params?.reqId as string

  const [data, setData] = useState<PreauthRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`/api/ehr/patients/${patientId}/preauth-requests/${reqId}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setData(j.preauth_request)
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() /* eslint-disable-line */ }, [patientId, reqId])

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>
  if (err || !data) return <div className="p-6 text-sm text-red-600">{err ?? 'Not found'}</div>

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href={`/dashboard/patients/${patientId}`}
          className="text-sm text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" /> Back to patient
        </Link>
        <button
          type="button"
          onClick={load}
          className="text-sm text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      <div className="border border-gray-200 rounded-xl p-5 bg-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-semibold text-gray-900">{data.payer_name}</div>
            <div className="text-sm text-gray-500">Member {data.member_id}</div>
          </div>
          <StatusBadge status={data.status} />
        </div>

        <dl className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Row label="Sessions requested">{data.requested_session_count}</Row>
          <Row label="Date span">
            {data.requested_start_date}
            {data.requested_end_date ? ` → ${data.requested_end_date}` : ' → open-ended'}
          </Row>
          <Row label="CPT codes">{data.cpt_codes.join(', ')}</Row>
          <Row label="Diagnosis codes">{data.diagnosis_codes.join(', ')}</Row>
          {data.submitted_at && (
            <>
              <Row label="Submitted">{new Date(data.submitted_at).toLocaleString()}</Row>
              <Row label="Method">{data.submission_method ?? '—'}{data.submission_reference ? ` (ref ${data.submission_reference})` : ''}</Row>
            </>
          )}
          {data.payer_response_received_at && (
            <Row label="Response received">{new Date(data.payer_response_received_at).toLocaleString()}</Row>
          )}
          {data.resulting_authorization_id && (
            <Row label="Resulting authorization">
              <Link
                href={`/dashboard/ehr/insurance-authorizations/${data.resulting_authorization_id}`}
                className="text-blue-600 hover:text-blue-800 underline font-mono text-xs"
              >
                {data.resulting_authorization_id.slice(0, 8)}…
              </Link>
            </Row>
          )}
        </dl>

        <div className="mt-4">
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Clinical justification</div>
          <div className="text-sm text-gray-800 whitespace-pre-wrap">{data.clinical_justification}</div>
        </div>

        {data.payer_response_summary && (
          <div className="mt-4">
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Payer response</div>
            <div className="text-sm text-gray-800 whitespace-pre-wrap">{data.payer_response_summary}</div>
          </div>
        )}
      </div>

      {data.status === 'draft' && (
        <SubmitBlock
          patientId={patientId}
          reqId={reqId}
          onSubmitted={load}
        />
      )}

      {(data.status === 'submitted' || data.status === 'pending') && (
        <RecordResponseBlock
          patientId={patientId}
          reqId={reqId}
          requestCpts={data.cpt_codes}
          requestStart={data.requested_start_date}
          requestEnd={data.requested_end_date}
          onRecorded={load}
        />
      )}

      {(['draft', 'submitted', 'pending'] as const).includes(data.status as any) && (
        <WithdrawBlock
          patientId={patientId}
          reqId={reqId}
          onWithdrawn={load}
        />
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: PreauthRequest['status'] }) {
  const map: Record<PreauthRequest['status'], { text: string; bg: string; tx: string }> = {
    draft:     { text: 'Draft',     bg: 'bg-gray-100',  tx: 'text-gray-700' },
    submitted: { text: 'Submitted', bg: 'bg-blue-100',  tx: 'text-blue-800' },
    pending:   { text: 'Pending',   bg: 'bg-amber-100', tx: 'text-amber-800' },
    approved:  { text: 'Approved',  bg: 'bg-green-100', tx: 'text-green-800' },
    denied:    { text: 'Denied',    bg: 'bg-red-100',   tx: 'text-red-800' },
    expired:   { text: 'Expired',   bg: 'bg-gray-100',  tx: 'text-gray-700' },
    withdrawn: { text: 'Withdrawn', bg: 'bg-gray-100',  tx: 'text-gray-700' },
  }
  const v = map[status]
  return <span className={`inline-flex text-xs px-2 py-0.5 rounded-full ${v.bg} ${v.tx}`}>{v.text}</span>
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{children}</dd>
    </div>
  )
}

function SubmitBlock({ patientId, reqId, onSubmitted }: { patientId: string; reqId: string; onSubmitted: () => void }) {
  const [method, setMethod] = useState<'fax' | 'portal' | 'email' | 'mail' | 'stedi_278'>('fax')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setErr(null); setBusy(true)
    try {
      const r = await fetch(`/api/ehr/patients/${patientId}/preauth-requests/${reqId}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submission_method: method, submission_reference: reference || null }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => null)
        throw new Error(j?.error?.message || `HTTP ${r.status}`)
      }
      // Stream the PDF to disk via blob URL.
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `preauth-${reqId}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      onSubmitted()
    } catch (e: any) {
      setErr(e?.message ?? 'Submit failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border border-blue-200 bg-blue-50/50 rounded-xl p-5">
      <div className="text-base font-medium text-gray-900 mb-2">Submit packet</div>
      <div className="text-sm text-gray-600 mb-3">
        Generates the PDF packet and marks this request as submitted. Choose how you sent it.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="block">
          <div className="text-xs text-gray-500 mb-0.5">Method</div>
          <select
            value={method}
            onChange={e => setMethod(e.target.value as any)}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="fax">Fax</option>
            <option value="portal">Payer portal</option>
            <option value="email">Email</option>
            <option value="mail">Mail</option>
            <option value="stedi_278">Stedi 278 (electronic)</option>
          </select>
        </label>
        <label className="block">
          <div className="text-xs text-gray-500 mb-0.5">Reference (fax confirm #, portal case #, etc.)</div>
          <input
            value={reference}
            onChange={e => setReference(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </label>
      </div>
      {err && <div className="text-sm text-red-600 mt-2">{err}</div>}
      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="mt-3 inline-flex items-center gap-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1.5 disabled:opacity-50"
      >
        <Download className="w-3 h-3" /> {busy ? 'Submitting…' : 'Submit & download PDF'}
      </button>
    </div>
  )
}

function RecordResponseBlock({
  patientId, reqId, requestCpts, requestStart, requestEnd, onRecorded,
}: {
  patientId: string; reqId: string;
  requestCpts: string[]; requestStart: string; requestEnd: string | null;
  onRecorded: () => void
}) {
  const [decision, setDecision] = useState<'pending' | 'approved' | 'denied' | 'expired'>('approved')
  const [summary, setSummary] = useState('')
  const [authNumber, setAuthNumber] = useState('')
  const [sessions, setSessions] = useState<number | ''>('')
  const [validFrom, setValidFrom] = useState(requestStart)
  const [validTo, setValidTo] = useState(requestEnd ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setErr(null); setBusy(true)
    try {
      const body: Record<string, unknown> = { decision, summary }
      if (decision === 'approved') {
        body.auth_number = authNumber
        body.sessions_authorized = Number(sessions)
        body.valid_from = validFrom || null
        body.valid_to = validTo || null
        body.cpt_codes_covered = requestCpts
      }
      const r = await fetch(`/api/ehr/patients/${patientId}/preauth-requests/${reqId}/record-response`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => null)
        throw new Error(j?.error?.message || `HTTP ${r.status}`)
      }
      onRecorded()
    } catch (e: any) {
      setErr(e?.message ?? 'Record failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl p-5">
      <div className="text-base font-medium text-gray-900 mb-2">Record payer response</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="block">
          <div className="text-xs text-gray-500 mb-0.5">Decision</div>
          <select
            value={decision}
            onChange={e => setDecision(e.target.value as any)}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="approved">Approved</option>
            <option value="pending">Pending (acknowledged, still reviewing)</option>
            <option value="denied">Denied</option>
            <option value="expired">Expired (no response)</option>
          </select>
        </label>
        <div /> {/* spacer */}
        {decision === 'approved' && (
          <>
            <label className="block">
              <div className="text-xs text-gray-500 mb-0.5">Auth number</div>
              <input
                value={authNumber}
                onChange={e => setAuthNumber(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono"
              />
            </label>
            <label className="block">
              <div className="text-xs text-gray-500 mb-0.5">Sessions authorized</div>
              <input
                type="number"
                min={0}
                value={sessions}
                onChange={e => setSessions(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <div className="text-xs text-gray-500 mb-0.5">Valid from</div>
              <input
                type="date"
                value={validFrom}
                onChange={e => setValidFrom(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <div className="text-xs text-gray-500 mb-0.5">Valid to (optional)</div>
              <input
                type="date"
                value={validTo}
                onChange={e => setValidTo(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </label>
          </>
        )}
      </div>
      <label className="block mt-2">
        <div className="text-xs text-gray-500 mb-0.5">Payer response summary</div>
        <textarea
          rows={3}
          value={summary}
          onChange={e => setSummary(e.target.value)}
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
        />
      </label>
      {err && <div className="text-sm text-red-600 mt-2">{err}</div>}
      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="mt-3 text-sm bg-gray-900 hover:bg-black text-white rounded px-3 py-1.5 disabled:opacity-50"
      >
        {busy ? 'Recording…' : 'Record response'}
      </button>
      {decision === 'approved' && (
        <div className="mt-2 text-xs text-gray-500">
          A new insurance-authorization row will be created and linked to this request.
        </div>
      )}
    </div>
  )
}

function WithdrawBlock({ patientId, reqId, onWithdrawn }: { patientId: string; reqId: string; onWithdrawn: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)

  async function go() {
    if (!confirm) { setConfirm(true); return }
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/ehr/patients/${patientId}/preauth-requests/${reqId}/withdraw`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason || null }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => null)
        throw new Error(j?.error?.message || `HTTP ${r.status}`)
      }
      onWithdrawn()
    } catch (e: any) {
      setErr(e?.message ?? 'Withdraw failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl p-5">
      <div className="text-base font-medium text-gray-900 mb-2">Withdraw request</div>
      <input
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Reason (optional)"
        className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
      />
      {err && <div className="text-sm text-red-600 mt-2">{err}</div>}
      <button
        type="button"
        disabled={busy}
        onClick={go}
        className="mt-3 text-sm border border-red-300 text-red-700 hover:bg-red-50 rounded px-3 py-1.5 disabled:opacity-50"
      >
        {busy ? 'Withdrawing…' : confirm ? 'Click again to confirm withdraw' : 'Withdraw'}
      </button>
    </div>
  )
}
