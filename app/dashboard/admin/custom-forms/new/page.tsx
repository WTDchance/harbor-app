// app/dashboard/admin/custom-forms/new/page.tsx
//
// W47 T2 — custom form builder. Reuses the W46 T4 question UX
// without the scoring panel.

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type QuestionType = 'likert_1_5' | 'likert_0_4' | 'yes_no' | 'numeric' | 'free_text' | 'multiple_choice'

interface Question {
  id: string
  text: string
  type: QuestionType
  required?: boolean
  choices?: Array<{ value: number; label: string }>
}

const KINDS = [
  { value: 'intake',        label: 'Intake' },
  { value: 'reflection',    label: 'Reflection' },
  { value: 'satisfaction',  label: 'Satisfaction' },
  { value: 'roi_request',   label: 'ROI request' },
  { value: 'custom',        label: 'Custom' },
] as const

export default function CustomFormBuilder() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<typeof KINDS[number]['value']>('custom')
  const [questions, setQuestions] = useState<Question[]>([
    { id: 'q1', text: '', type: 'free_text' },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateQuestion(i: number, patch: Partial<Question>) {
    setQuestions(questions.map((q, idx) => idx === i ? { ...q, ...patch } : q))
  }
  function addQuestion() {
    setQuestions([...questions, { id: `q${questions.length + 1}`, text: '', type: 'free_text' }])
  }
  function removeQuestion(i: number) {
    setQuestions(questions.filter((_, idx) => idx !== i))
  }

  async function save() {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/ehr/custom-forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, kind, questions }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Save failed')
      }
      router.push('/dashboard/admin/custom-forms')
    } catch (e) {
      setError((e as Error).message)
    } finally { setSaving(false) }
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">New form</h1>
        <p className="text-sm text-gray-600 mt-1">
          Intake questions, ROI request templates, post-session reflections,
          satisfaction surveys — anything you want patients to fill out.
        </p>
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <section className="rounded border bg-white p-4 space-y-3">
        <label className="block text-sm">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required
                 className="block w-full border rounded px-2 py-1 mt-1" />
        </label>
        <label className="block text-sm">
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as any)}
                  className="block w-full border rounded px-2 py-1 mt-1">
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          Description (optional)
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                    className="block w-full border rounded px-2 py-1 mt-1" />
        </label>
      </section>

      <section className="rounded border bg-white p-4 space-y-3">
        <h2 className="font-medium">Questions</h2>
        {questions.map((q, i) => (
          <div key={i} className="border-l-2 border-blue-300 pl-3 space-y-2">
            <div className="flex gap-2">
              <input value={q.text} onChange={(e) => updateQuestion(i, { text: e.target.value })}
                     placeholder="Question text"
                     className="flex-1 border rounded px-2 py-1 text-sm" />
              <select value={q.type} onChange={(e) => updateQuestion(i, { type: e.target.value as QuestionType })}
                      className="border rounded px-2 py-1 text-sm">
                <option value="free_text">Free text</option>
                <option value="likert_1_5">Likert 1-5</option>
                <option value="likert_0_4">Likert 0-4</option>
                <option value="yes_no">Yes/No</option>
                <option value="numeric">Numeric</option>
                <option value="multiple_choice">Multiple choice</option>
              </select>
              <button onClick={() => removeQuestion(i)}
                      className="text-red-600 text-xs hover:underline">×</button>
            </div>
            <label className="text-xs flex items-center gap-1">
              <input type="checkbox" checked={!!q.required}
                     onChange={(e) => updateQuestion(i, { required: e.target.checked })} />
              Required
            </label>
          </div>
        ))}
        <button onClick={addQuestion}
                className="text-sm text-[#1f375d] hover:underline">+ Add question</button>
      </section>

      <button onClick={save} disabled={saving || !name.trim() || questions.some((q) => !q.text.trim())}
              className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50">
        {saving ? 'Saving…' : 'Save form'}
      </button>
    </div>
  )
}
