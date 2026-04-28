// app/dashboard/patients/[id]/forms/page.tsx
// W47 T2 — patient detail Forms tab.

'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type Question = { id: string; text: string; type: string }
type Response = {
  id: string
  form_id: string
  responses: Record<string, unknown>
  submitted_by: string
  submitted_at: string
  form_name: string
  form_kind: string
  form_questions: Question[]
}

export default function PatientFormsTab() {
  const params = useParams<{ id: string }>()
  const patientId = params?.id as string
  const [responses, setResponses] = useState<Response[]>([])
  const [loading, setLoading] = useState(true)
  const [available, setAvailable] = useState<Array<{ id: string; name: string; kind: string }>>([])
  const [sending, setSending] = useState<string | null>(null)
  const [sendNote, setSendNote] = useState<string | null>(null)

  async function load() {
    try {
      const [respRes, formsRes] = await Promise.all([
        fetch(`/api/ehr/patients/${patientId}/form-responses`),
        fetch('/api/ehr/custom-forms'),
      ])
      if (respRes.ok) setResponses((await respRes.json()).responses || [])
      if (formsRes.ok) setAvailable((await formsRes.json()).forms || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { if (patientId) void load() }, [patientId])

  async function send(formId: string) {
    setSending(formId); setSendNote(null)
    try {
      const res = await fetch(`/api/ehr/custom-forms/${formId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_ids: [patientId] }),
      })
      if (!res.ok) throw new Error('Send failed')
      setSendNote('Sent. The patient will see it on their portal.')
      setTimeout(() => setSendNote(null), 4000)
    } catch (e) {
      setSendNote(`Couldn't send: ${(e as Error).message}`)
    } finally { setSending(null) }
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Forms</h1>
        <p className="text-sm text-gray-600 mt-1">
          Forms this patient has submitted, plus practice forms you can send to them.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Send a form</h2>
        {available.length === 0 ? (
          <p className="text-sm text-gray-500">No active forms. Build one in Settings → Forms.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {available.map((f) => (
              <button key={f.id} onClick={() => send(f.id)}
                      disabled={sending === f.id}
                      className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50">
                {sending === f.id ? 'Sending…' : `Send "${f.name}" (${f.kind.replace(/_/g, ' ')})`}
              </button>
            ))}
          </div>
        )}
        {sendNote && <p className="text-xs text-green-700">{sendNote}</p>}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Submitted</h2>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : responses.length === 0 ? (
          <p className="text-sm text-gray-500">No responses yet.</p>
        ) : (
          <ul className="space-y-3">
            {responses.map((r) => (
              <li key={r.id} className="rounded border bg-white p-3">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{r.form_name}</span>
                  <span className="text-xs text-gray-500">
                    {r.form_kind.replace(/_/g, ' ')} · {new Date(r.submitted_at).toLocaleString()}
                  </span>
                </div>
                <ol className="text-xs text-gray-700 mt-2 space-y-1">
                  {r.form_questions.map((q) => (
                    <li key={q.id} className="border-t pt-1">
                      <div className="text-gray-600">{q.text}</div>
                      <div className="font-medium">{String(r.responses[q.id] ?? '—')}</div>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
