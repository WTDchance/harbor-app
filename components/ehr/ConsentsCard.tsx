// components/ehr/ConsentsCard.tsx
// Per-patient consent checklist. Shows every standard consent with its
// current status (signed / pending / not on file), and one-click marking
// as signed in-person. Revocation and full-audit-history viewing live on
// a dedicated page that's a natural next step but not in tonight's slice.

'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, FileText, Circle, Clock } from 'lucide-react'
import { STANDARD_CONSENTS } from '@/lib/ehr/consents'

type Consent = {
  id: string
  consent_type: string
  version: string
  status: string
  signed_at: string | null
  signed_by_name: string | null
  signed_method: string | null
}

export function ConsentsCard({ patientId }: { patientId: string }) {
  const [items, setItems] = useState<Consent[] | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/ehr/consents?patient_id=${encodeURIComponent(patientId)}`)
      if (res.status === 403) { setEnabled(false); return }
      const json = await res.json()
      setItems(json.consents || [])
    } finally { setLoading(false) }
  }, [patientId])

  useEffect(() => { load() }, [load])

  async function signInPerson(type: string) {
    setWorking(type)
    try {
      // Find existing record for this type (most recent), otherwise create-and-sign
      const existing = (items || []).find((c) => c.consent_type === type && c.status === 'pending')
      if (existing) {
        const res = await fetch(`/api/ehr/consents/${existing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sign', signed_method: 'in_person' }),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      } else {
        const def = STANDARD_CONSENTS.find((c) => c.type === type)
        const res = await fetch('/api/ehr/consents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patient_id: patientId,
            consent_type: type,
            document_name: def?.label,
            sign_now: true,
            signed_method: 'in_person',
          }),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      }
      await load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed')
    } finally {
      setWorking(null)
    }
  }

  if (!enabled || loading) return null

  // Latest record per consent_type
  const latest = new Map<string, Consent>()
  for (const c of items || []) {
    if (!latest.has(c.consent_type)) latest.set(c.consent_type, c)
  }

  return (
    <div className="bg-white border rounded-lg p-5 shadow-sm">
      <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
        <FileText className="w-4 h-4 text-gray-500" />
        Consents &amp; Agreements
      </h2>
      <ul className="divide-y divide-gray-100">
        {STANDARD_CONSENTS.map((def) => {
          const current = latest.get(def.type)
          const signed = current?.status === 'signed'
          const pending = current?.status === 'pending'
          return (
            <li key={def.type} className="py-2.5 flex items-center gap-3">
              <StatusIcon signed={signed} pending={pending} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate">{def.label}</span>
                  {def.required && !signed && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                      required
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {signed && current?.signed_at ? (
                    <>Signed {formatDate(current.signed_at)}{current.signed_method ? ` · ${current.signed_method.replace('_', ' ')}` : ''}</>
                  ) : pending ? (
                    'Awaiting signature'
                  ) : (
                    def.description
                  )}
                </div>
              </div>
              {!signed && (
                <button
                  type="button"
                  disabled={working === def.type}
                  onClick={() => signInPerson(def.type)}
                  className="text-xs bg-white border border-teal-600 text-teal-700 px-2.5 py-1 rounded-md hover:bg-teal-50 disabled:opacity-50"
                >
                  {working === def.type ? 'Saving…' : 'Mark signed'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function StatusIcon({ signed, pending }: { signed: boolean; pending: boolean }) {
  if (signed) return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
  if (pending) return <Clock className="w-4 h-4 text-amber-600 shrink-0" />
  return <Circle className="w-4 h-4 text-gray-300 shrink-0" />
}

function formatDate(iso: string): string {
  const d = new Date(iso); if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
