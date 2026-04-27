// components/ehr/Part2ConsentsCard.tsx
//
// Wave 41 — 42 CFR Part 2 separate consent track. Lists active +
// expired + revoked consents and the disclosures made under them.
// Therapist captures structured statutory fields here; we never
// auto-suggest treatment via AI on this surface.

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2, FileText, AlertTriangle, ShieldAlert, Send, Plus, X,
} from 'lucide-react'

type Consent = {
  id: string
  document_id: string
  patient_id: string
  signed_at: string | null
  signed_name: string | null
  metadata: any
  revoked_at: string | null
  revoked_by: string | null
  kind: string
  version: string
  body_md: string
  is_active: boolean
}

type Disclosure = {
  id: string
  consent_signature_id: string
  disclosed_to: string
  disclosed_at: string
  what_was_disclosed: string
  recipient_acknowledged_redisclosure_prohibition: boolean
  notes: string | null
  created_at: string
}

const TAP = 'min-h-[44px]'

export function Part2ConsentsCard({ patientId }: { patientId: string }) {
  const [consents, setConsents] = useState<Consent[] | null>(null)
  const [disclosures, setDisclosures] = useState<Disclosure[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [showConsentForm, setShowConsentForm] = useState(false)
  const [showDisclosureForm, setShowDisclosureForm] = useState(false)
  const [working, setWorking] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cRes, dRes] = await Promise.all([
        fetch(`/api/ehr/patients/${encodeURIComponent(patientId)}/part2-consents`),
        fetch(`/api/ehr/patients/${encodeURIComponent(patientId)}/part2-disclosures`),
      ])
      const cJson = await cRes.json().catch(() => ({}))
      const dJson = await dRes.json().catch(() => ({}))
      setConsents(cJson.consents || [])
      setDisclosures(dJson.disclosures || [])
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => { load() }, [load])

  const active = useMemo(
    () => (consents || []).filter((c) => c.is_active),
    [consents],
  )
  const inactive = useMemo(
    () => (consents || []).filter((c) => !c.is_active),
    [consents],
  )

  async function revoke(consentId: string) {
    if (!confirm('Revoke this Part 2 consent? Disclosures already made are unaffected.')) return
    setWorking(true)
    try {
      const res = await fetch(
        `/api/ehr/patients/${encodeURIComponent(patientId)}/part2-consents/${encodeURIComponent(consentId)}/revoke`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setErrorMsg(j.error || 'Failed to revoke')
        return
      }
      await load()
    } finally {
      setWorking(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-sm text-gray-500">Loading 42 CFR Part 2 consents…</div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
      <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-md">
        <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900">
          42 CFR Part 2 governs disclosure of substance use disorder
          records. Each disclosure requires its own structured consent
          and travels with a re-disclosure prohibition notice.
        </div>
      </div>

      {errorMsg && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
          {errorMsg}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => { setErrorMsg(null); setShowConsentForm((v) => !v) }}
          className={`${TAP} inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-teal-600 text-white text-sm hover:bg-teal-700`}
        >
          <Plus className="w-4 h-4" /> New Part 2 consent
        </button>
        <button
          type="button"
          disabled={!active.length}
          onClick={() => { setErrorMsg(null); setShowDisclosureForm((v) => !v) }}
          className={`${TAP} inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-teal-600 text-teal-700 text-sm hover:bg-teal-50 disabled:opacity-50 disabled:cursor-not-allowed`}
          title={active.length ? '' : 'No active consent on file'}
        >
          <Send className="w-4 h-4" /> Record disclosure
        </button>
      </div>

      {showConsentForm && (
        <NewConsentForm
          patientId={patientId}
          onCancel={() => setShowConsentForm(false)}
          onSaved={async () => { setShowConsentForm(false); await load() }}
          onError={(m) => setErrorMsg(m)}
        />
      )}

      {showDisclosureForm && active.length > 0 && (
        <NewDisclosureForm
          patientId={patientId}
          activeConsents={active}
          onCancel={() => setShowDisclosureForm(false)}
          onSaved={async () => { setShowDisclosureForm(false); await load() }}
          onError={(m) => setErrorMsg(m)}
        />
      )}

      <div>
        <h4 className="text-sm font-semibold text-gray-800 mb-2">Active consents</h4>
        {active.length === 0 ? (
          <div className="text-sm text-gray-500">No active Part 2 consents on file.</div>
        ) : (
          <ul className="space-y-2">
            {active.map((c) => (
              <ConsentRow key={c.id} c={c} onRevoke={() => revoke(c.id)} working={working} />
            ))}
          </ul>
        )}
      </div>

      {inactive.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Expired or revoked</h4>
          <ul className="space-y-2">
            {inactive.map((c) => (
              <ConsentRow key={c.id} c={c} onRevoke={() => {}} working={false} hideRevoke />
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-gray-800 mb-2">Disclosures made</h4>
        {(!disclosures || disclosures.length === 0) ? (
          <div className="text-sm text-gray-500">No disclosures recorded.</div>
        ) : (
          <ul className="space-y-2">
            {disclosures.map((d) => (
              <li key={d.id} className="border border-gray-200 rounded-md p-3 text-sm">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-medium text-gray-900">{d.disclosed_to}</div>
                  <div className="text-xs text-gray-500">{formatDate(d.disclosed_at)}</div>
                </div>
                <div className="text-xs text-gray-700 mt-1 whitespace-pre-wrap">{d.what_was_disclosed}</div>
                <div className="text-xs mt-1 flex items-center gap-1">
                  {d.recipient_acknowledged_redisclosure_prohibition ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Recipient acknowledged re-disclosure prohibition
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-700">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Recipient did NOT acknowledge re-disclosure prohibition
                    </span>
                  )}
                </div>
                {d.notes && (
                  <div className="text-xs text-gray-500 mt-1">Notes: {d.notes}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ConsentRow({
  c, onRevoke, working, hideRevoke,
}: { c: Consent; onRevoke: () => void; working: boolean; hideRevoke?: boolean }) {
  const meta = c.metadata || {}
  return (
    <li className="border border-gray-200 rounded-md p-3 text-sm">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="font-medium text-gray-900 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-teal-700" />
            {meta.recipient_name || '(no recipient)'}
          </div>
          <div className="text-xs text-gray-500">
            Signed {c.signed_at ? formatDate(c.signed_at) : '—'}
            {c.revoked_at && (
              <span className="text-red-700"> · revoked {formatDate(c.revoked_at)}</span>
            )}
          </div>
        </div>
        {!hideRevoke && !c.revoked_at && (
          <button
            type="button"
            disabled={working}
            onClick={onRevoke}
            className={`${TAP} text-xs px-3 py-2 rounded-md border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50`}
          >
            Revoke
          </button>
        )}
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 mt-2 text-xs text-gray-700">
        {meta.purpose_of_disclosure && (
          <div><dt className="inline font-semibold">Purpose: </dt><dd className="inline">{meta.purpose_of_disclosure}</dd></div>
        )}
        {meta.amount_and_kind_of_information && (
          <div><dt className="inline font-semibold">Scope: </dt><dd className="inline">{meta.amount_and_kind_of_information}</dd></div>
        )}
        {meta.recipient_address && (
          <div className="sm:col-span-2"><dt className="inline font-semibold">Recipient address: </dt><dd className="inline">{meta.recipient_address}</dd></div>
        )}
        {meta.expiration_date && (
          <div><dt className="inline font-semibold">Expires: </dt><dd className="inline">{formatDate(meta.expiration_date)}</dd></div>
        )}
        {meta.expiration_event && (
          <div><dt className="inline font-semibold">Expires on event: </dt><dd className="inline">{meta.expiration_event}</dd></div>
        )}
      </dl>
    </li>
  )
}

function NewConsentForm({
  patientId, onCancel, onSaved, onError,
}: {
  patientId: string
  onCancel: () => void
  onSaved: () => Promise<void>
  onError: (msg: string) => void
}) {
  const [recipientName, setRecipientName] = useState('')
  const [recipientAddress, setRecipientAddress] = useState('')
  const [purpose, setPurpose] = useState('')
  const [amount, setAmount] = useState('')
  const [expirationDate, setExpirationDate] = useState('')
  const [expirationEvent, setExpirationEvent] = useState('')
  const [signatureDate, setSignatureDate] = useState(new Date().toISOString().slice(0, 10))
  const [signedName, setSignedName] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!recipientName || !recipientAddress || !purpose || !amount) {
      onError('All fields are required (recipient, purpose, amount, address).')
      return
    }
    if (!expirationDate && !expirationEvent) {
      onError('Provide either an expiration date or an expiration event.')
      return
    }
    setBusy(true)
    try {
      // Tiny placeholder data URL — the structured fields are the
      // legally relevant part; the practice can later attach a richer
      // captured signature image via a future endpoint.
      const placeholderSig =
        'data:image/svg+xml;utf8,' +
        encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><text x="4" y="26" font-family="cursive" font-size="20">${signedName || 'Patient'}</text></svg>`)
      const res = await fetch(
        `/api/ehr/patients/${encodeURIComponent(patientId)}/part2-consents`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signed_name: signedName || null,
            signature_data_url: placeholderSig,
            metadata: {
              recipient_name: recipientName,
              recipient_address: recipientAddress,
              purpose_of_disclosure: purpose,
              amount_and_kind_of_information: amount,
              expiration_date: expirationDate || undefined,
              expiration_event: expirationEvent || undefined,
              patient_signature_date: signatureDate,
            },
          }),
        },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        onError(j.error === 'invalid_metadata'
          ? `Invalid: ${(j.errors || []).join(', ')}`
          : (j.error || 'Failed to save consent'))
        return
      }
      await onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="border border-teal-200 bg-teal-50/30 rounded-md p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="text-sm font-semibold text-gray-900">New 42 CFR Part 2 consent</h5>
        <button type="button" onClick={onCancel} className={`${TAP} px-2 py-2 text-gray-500 hover:text-gray-700`}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <Field label="Recipient name *">
        <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Recipient address *">
        <textarea value={recipientAddress} onChange={(e) => setRecipientAddress(e.target.value)} rows={2} className={inputCls} />
      </Field>
      <Field label="Purpose of disclosure *">
        <input value={purpose} onChange={(e) => setPurpose(e.target.value)} className={inputCls} placeholder="e.g. coordination of care" />
      </Field>
      <Field label="Amount and kind of information *">
        <textarea value={amount} onChange={(e) => setAmount(e.target.value)} rows={2} className={inputCls} placeholder="e.g. SUD treatment summary 2026-01 to 2026-04" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Expiration date">
          <input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="…or expiration event">
          <input value={expirationEvent} onChange={(e) => setExpirationEvent(e.target.value)} className={inputCls} placeholder="e.g. termination of treatment" />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Patient signature date *">
          <input type="date" value={signatureDate} onChange={(e) => setSignatureDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Patient signed name">
          <input value={signedName} onChange={(e) => setSignedName(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={`${TAP} px-3 py-2 rounded-md border border-gray-300 text-sm`}>Cancel</button>
        <button type="submit" disabled={busy} className={`${TAP} px-4 py-2 rounded-md bg-teal-600 text-white text-sm hover:bg-teal-700 disabled:opacity-50`}>
          {busy ? 'Saving…' : 'Save consent'}
        </button>
      </div>
    </form>
  )
}

function NewDisclosureForm({
  patientId, activeConsents, onCancel, onSaved, onError,
}: {
  patientId: string
  activeConsents: Consent[]
  onCancel: () => void
  onSaved: () => Promise<void>
  onError: (msg: string) => void
}) {
  const [consentSignatureId, setConsentSignatureId] = useState(activeConsents[0]?.id || '')
  const [whatWasDisclosed, setWhatWasDisclosed] = useState('')
  const [ack, setAck] = useState(false)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const selected = activeConsents.find((c) => c.id === consentSignatureId)
  const disclosedTo = selected?.metadata?.recipient_name || ''

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!consentSignatureId) { onError('Pick an active consent.'); return }
    if (!whatWasDisclosed.trim()) { onError('Describe what was disclosed.'); return }
    setBusy(true)
    try {
      const res = await fetch(
        `/api/ehr/patients/${encodeURIComponent(patientId)}/part2-disclosures`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            consent_signature_id: consentSignatureId,
            disclosed_to: disclosedTo,
            what_was_disclosed: whatWasDisclosed,
            recipient_acknowledged_redisclosure_prohibition: ack,
            notes: notes || null,
          }),
        },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        onError(j.error || 'Failed to record disclosure')
        return
      }
      await onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="border border-teal-200 bg-teal-50/30 rounded-md p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="text-sm font-semibold text-gray-900">Record Part 2 disclosure</h5>
        <button type="button" onClick={onCancel} className={`${TAP} px-2 py-2 text-gray-500 hover:text-gray-700`}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <Field label="Active consent *">
        <select
          value={consentSignatureId}
          onChange={(e) => setConsentSignatureId(e.target.value)}
          className={inputCls}
        >
          {activeConsents.map((c) => (
            <option key={c.id} value={c.id}>
              {c.metadata?.recipient_name || '(no recipient)'} —{' '}
              {c.metadata?.purpose_of_disclosure || '(no purpose)'}
            </option>
          ))}
        </select>
      </Field>
      <Field label="What was disclosed *">
        <textarea value={whatWasDisclosed} onChange={(e) => setWhatWasDisclosed(e.target.value)} rows={3} className={inputCls} />
      </Field>
      <label className={`${TAP} flex items-start gap-2 cursor-pointer text-sm`}>
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
          className="mt-1 w-5 h-5"
        />
        <span>Recipient acknowledged the 42 CFR Part 2 re-disclosure prohibition.</span>
      </label>
      <Field label="Notes">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={`${TAP} px-3 py-2 rounded-md border border-gray-300 text-sm`}>Cancel</button>
        <button type="submit" disabled={busy} className={`${TAP} px-4 py-2 rounded-md bg-teal-600 text-white text-sm hover:bg-teal-700 disabled:opacity-50`}>
          {busy ? 'Recording…' : 'Record disclosure'}
        </button>
      </div>
    </form>
  )
}

const inputCls =
  'w-full min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="block text-xs font-semibold text-gray-700 mb-1">{label}</span>
      {children}
    </label>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso); if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
