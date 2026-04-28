// app/portal/forms/page.tsx
// W47 T2 — patient portal forms list + submit.

'use client'

import { useEffect, useState } from 'react'

type Question = { id: string; text: string; type: string; required?: boolean; choices?: Array<{ value: number; label: string }> }
type Form = { id: string; name: string; description: string | null; kind: string; questions: Question[]; prior_responses: number }

export default function PortalFormsPage() {
  const [forms, setForms] = useState<Form[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/portal/forms')
      if (r.ok) setForms((await r.json()).forms || [])
    })()
  }, [])

  const active = forms.find((f) => f.id === activeId) || null

  async function submit() {
    if (!active) return
    setSubmitting(true); setError(null)
    try {
      const res = await fetch(`/api/portal/forms/${active.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses: answers }),
      })
      if (!res.ok) throw new Error('Submit failed')
      setDone('Thanks — submitted to your therapist.')
      setActiveId(null); setAnswers({})
    } catch (e) {
      setError((e as Error).message)
    } finally { setSubmitting(false) }
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-semibold">Forms</h1>

      {done && <div className="rounded bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">{done}</div>}
      {error && <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!active && (
        <ul className="space-y-2">
          {forms.length === 0 ? (
            <li className="text-sm text-gray-500">No forms available.</li>
          ) : forms.map((f) => (
            <li key={f.id} className="rounded border bg-white p-3">
              <button onClick={() => setActiveId(f.id)} className="text-left w-full">
                <div className="font-medium">{f.name}</div>
                <div className="text-xs text-gray-500">{f.kind.replace(/_/g, ' ')} · {f.questions.length} questions{f.prior_responses > 0 ? ` · ${f.prior_responses} prior submissions` : ''}</div>
                {f.description && <div className="text-xs text-gray-600 mt-1">{f.description}</div>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {active && (
        <section className="rounded border bg-white p-3 space-y-3">
          <button onClick={() => setActiveId(null)} className="text-xs text-gray-500 hover:underline">← Back</button>
          <h2 className="font-medium">{active.name}</h2>
          {active.questions.map((q) => (
            <div key={q.id} className="space-y-1">
              <label className="text-sm">
                {q.text}{q.required && <span className="text-red-500"> *</span>}
              </label>
              {q.type === 'free_text' ? (
                <textarea value={String(answers[q.id] ?? '')}
                          onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                          rows={3}
                          className="block w-full border rounded px-2 py-1 text-sm" />
              ) : q.type === 'yes_no' ? (
                <select value={String(answers[q.id] ?? '')}
                        onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                        className="block w-full border rounded px-2 py-1 text-sm">
                  <option value="">—</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              ) : q.type === 'multiple_choice' ? (
                <select value={String(answers[q.id] ?? '')}
                        onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                        className="block w-full border rounded px-2 py-1 text-sm">
                  <option value="">—</option>
                  {q.choices?.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              ) : (
                <input type="number"
                       value={String(answers[q.id] ?? '')}
                       onChange={(e) => setAnswers({ ...answers, [q.id]: Number(e.target.value) })}
                       className="block w-full border rounded px-2 py-1 text-sm" />
              )}
            </div>
          ))}
          <button onClick={submit} disabled={submitting}
                  className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50 w-full">
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </section>
      )}
    </div>
  )
}
