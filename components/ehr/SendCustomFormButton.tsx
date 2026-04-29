// components/ehr/SendCustomFormButton.tsx
//
// W49 D1 — patient-detail action: pick a published custom form and
// dispatch it to this patient. Returns a portal URL the practice can
// copy or text to the patient.

'use client'

import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'

interface Form { id: string; name: string; status: string }

export default function SendCustomFormButton({ patientId, compact }: { patientId: string; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [forms, setForms] = useState<Form[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState<string | null>(null)
  const [result, setResult] = useState<{ url: string; formName: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch('/api/ehr/practice/custom-forms?status=published')
      .then(r => r.json())
      .then(j => setForms(j.forms ?? []))
      .catch(() => setError('Could not load forms'))
      .finally(() => setLoading(false))
  }, [open])

  async function send(formId: string, formName: string) {
    setSending(formId); setError(null)
    try {
      const res = await fetch(`/api/ehr/patients/${patientId}/custom-forms/${formId}/send`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok) setError(j.error || 'Send failed')
      else setResult({ url: j.portal_url, formName })
    } finally { setSending(null) }
  }

  function copy() {
    if (!result) return
    navigator.clipboard?.writeText(result.url).catch(() => null)
  }

  return (
    <>
      <button
        type="button" onClick={() => setOpen(true)}
        className={compact
          ? 'inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900'
          : 'inline-flex items-center gap-1.5 text-sm border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-md'}
      >
        <FileText className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        Send form
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => { setOpen(false); setResult(null) }}>
          <div className="bg-white rounded-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Send a custom form</h2>
              <button onClick={() => { setOpen(false); setResult(null) }} className="text-gray-400 hover:text-gray-600">×</button>
            </div>

            {result ? (
              <div className="mt-4 space-y-3">
                <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-3">
                  Sent “{result.formName}”. Share this link with the patient:
                </div>
                <div className="flex gap-2">
                  <input readOnly value={result.url} className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-xs font-mono" />
                  <button onClick={copy} className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md">Copy</button>
                </div>
                <button onClick={() => setResult(null)} className="text-sm text-gray-600 hover:text-gray-900">Send another</button>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {loading && <div className="text-sm text-gray-500">Loading…</div>}
                {error && <div className="text-sm text-red-600">{error}</div>}
                {!loading && forms.length === 0 && (
                  <p className="text-sm text-gray-500">
                    No published forms yet. Build one in <a href="/dashboard/settings/forms" className="text-blue-600 hover:underline">Settings → Forms</a>.
                  </p>
                )}
                {forms.map(f => (
                  <button
                    key={f.id} onClick={() => send(f.id, f.name)} disabled={sending !== null}
                    className="w-full flex items-center justify-between px-3 py-2 border border-gray-200 rounded-md hover:border-blue-400 disabled:opacity-50"
                  >
                    <span className="text-sm text-gray-900">{f.name}</span>
                    <span className="text-xs text-gray-500">{sending === f.id ? 'Sending…' : 'Send →'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
