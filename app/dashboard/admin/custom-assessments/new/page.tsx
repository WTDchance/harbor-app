// app/dashboard/admin/custom-assessments/new/page.tsx
//
// W46 T4 — custom assessment builder. Add questions, pick a scoring
// function, define severity bands, preview test scoring before saving.

'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type QuestionType = 'likert_1_5' | 'likert_0_4' | 'yes_no' | 'numeric' | 'free_text' | 'multiple_choice'

interface Question {
  id: string
  text: string
  type: QuestionType
  choices?: Array<{ value: number; label: string }>
  score_weight?: number
  reverse_scored?: boolean
  subscale?: string
}

interface SeverityBand {
  min: number
  max: number
  label: string
  color?: string
  alert_on_threshold?: boolean
}

const SCORING_FUNCTIONS = [
  { value: 'sum',          label: 'Sum (PHQ-9 / GAD-7 style)' },
  { value: 'mean',          label: 'Mean' },
  { value: 'weighted_sum',  label: 'Weighted sum (uses score_weight)' },
  { value: 'max_subscale',  label: 'Max subscale' },
  { value: 'phq9_like',     label: 'PHQ-9-like (sum + 0..27)' },
  { value: 'gad7_like',     label: 'GAD-7-like (sum + 0..21)' },
] as const

export default function CustomAssessmentBuilder() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scoringFunction, setScoringFunction] = useState('sum')
  const [questions, setQuestions] = useState<Question[]>([
    { id: 'q1', text: '', type: 'likert_1_5' },
  ])
  const [bands, setBands] = useState<SeverityBand[]>([
    { min: 0, max: 4, label: 'Minimal', color: '#10b981' },
    { min: 5, max: 9, label: 'Mild', color: '#52bfc0' },
    { min: 10, max: 14, label: 'Moderate', color: '#f59e0b', alert_on_threshold: true },
    { min: 15, max: 100, label: 'Severe', color: '#dc2626', alert_on_threshold: true },
  ])
  const [testAnswers, setTestAnswers] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateQuestion(i: number, patch: Partial<Question>) {
    setQuestions(questions.map((q, idx) => idx === i ? { ...q, ...patch } : q))
  }
  function addQuestion() {
    setQuestions([...questions, { id: `q${questions.length + 1}`, text: '', type: 'likert_1_5' }])
  }
  function removeQuestion(i: number) {
    setQuestions(questions.filter((_, idx) => idx !== i))
  }

  function updateBand(i: number, patch: Partial<SeverityBand>) {
    setBands(bands.map((b, idx) => idx === i ? { ...b, ...patch } : b))
  }
  function addBand() { setBands([...bands, { min: 0, max: 0, label: '' }]) }
  function removeBand(i: number) { setBands(bands.filter((_, idx) => idx !== i)) }

  // Preview score in-memory, mirrors the server-side allow-list scoring.
  const previewScore = useMemo(() => {
    function answerNum(q: Question, raw: any): number {
      if (q.type === 'free_text') return 0
      if (q.type === 'yes_no') return raw === 'yes' || raw === 1 ? 1 : 0
      const n = Number(raw); return Number.isFinite(n) ? n : 0
    }
    function withReverse(q: Question, v: number): number {
      if (!q.reverse_scored) return v
      if (q.type === 'likert_1_5') return 6 - v
      if (q.type === 'likert_0_4') return 4 - v
      if (q.type === 'yes_no') return 1 - v
      return v
    }
    const numerics = questions.map((q) => withReverse(q, answerNum(q, testAnswers[q.id])))
    let total = 0
    if (scoringFunction === 'sum' || scoringFunction === 'phq9_like' || scoringFunction === 'gad7_like') {
      total = numerics.reduce((a, b) => a + b, 0)
    } else if (scoringFunction === 'mean') {
      const n = numerics.filter((v, i) => questions[i].type !== 'free_text')
      total = n.length === 0 ? 0 : n.reduce((a, b) => a + b, 0) / n.length
    } else if (scoringFunction === 'weighted_sum') {
      total = numerics.reduce((s, v, i) => s + v * (questions[i].score_weight ?? 1), 0)
    }
    const band = bands.find((b) => total >= b.min && total <= b.max) || null
    return { total: Math.round(total * 100) / 100, band }
  }, [questions, testAnswers, scoringFunction, bands])

  async function save() {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/ehr/custom-assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, scoring_function: scoringFunction, questions, severity_bands: bands }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Save failed')
      }
      router.push('/dashboard/admin/custom-assessments')
    } catch (e) {
      setError((e as Error).message)
    } finally { setSaving(false) }
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">New custom assessment</h1>
        <p className="text-sm text-gray-600 mt-1">
          Build your practice's own scale. Pick a scoring approach
          from the locked list — no arbitrary code runs.
        </p>
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <section className="rounded border bg-white p-4 space-y-3">
        <h2 className="font-medium">Basics</h2>
        <label className="block text-sm">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required
                 className="block w-full border rounded px-2 py-1 mt-1" />
        </label>
        <label className="block text-sm">
          Description (optional)
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    className="block w-full border rounded px-2 py-1 mt-1" />
        </label>
        <label className="block text-sm">
          Scoring function
          <select value={scoringFunction} onChange={(e) => setScoringFunction(e.target.value)}
                  className="block w-full border rounded px-2 py-1 mt-1">
            {SCORING_FUNCTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
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
                <option value="likert_1_5">Likert 1-5</option>
                <option value="likert_0_4">Likert 0-4</option>
                <option value="yes_no">Yes/No</option>
                <option value="numeric">Numeric</option>
                <option value="free_text">Free text</option>
                <option value="multiple_choice">Multiple choice</option>
              </select>
              <button onClick={() => removeQuestion(i)}
                      className="text-red-600 text-xs hover:underline">×</button>
            </div>
            <div className="flex gap-3 text-xs">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={!!q.reverse_scored}
                       onChange={(e) => updateQuestion(i, { reverse_scored: e.target.checked })} />
                Reverse scored
              </label>
              {scoringFunction === 'weighted_sum' && (
                <label className="flex items-center gap-1">
                  Weight
                  <input type="number" step={0.1} value={q.score_weight ?? 1}
                         onChange={(e) => updateQuestion(i, { score_weight: Number(e.target.value) })}
                         className="w-16 border rounded px-1 py-0.5" />
                </label>
              )}
              {scoringFunction === 'max_subscale' && (
                <label className="flex items-center gap-1">
                  Subscale
                  <input value={q.subscale || ''}
                         onChange={(e) => updateQuestion(i, { subscale: e.target.value })}
                         className="border rounded px-1 py-0.5 w-24" />
                </label>
              )}
            </div>
          </div>
        ))}
        <button onClick={addQuestion}
                className="text-sm text-[#1f375d] hover:underline">+ Add question</button>
      </section>

      <section className="rounded border bg-white p-4 space-y-3">
        <h2 className="font-medium">Severity bands</h2>
        <div className="space-y-2">
          {bands.map((b, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 text-sm items-center">
              <input type="number" value={b.min}
                     onChange={(e) => updateBand(i, { min: Number(e.target.value) })}
                     className="col-span-2 border rounded px-1 py-1" placeholder="min" />
              <input type="number" value={b.max}
                     onChange={(e) => updateBand(i, { max: Number(e.target.value) })}
                     className="col-span-2 border rounded px-1 py-1" placeholder="max" />
              <input value={b.label}
                     onChange={(e) => updateBand(i, { label: e.target.value })}
                     className="col-span-3 border rounded px-1 py-1" placeholder="label" />
              <input value={b.color || ''}
                     onChange={(e) => updateBand(i, { color: e.target.value })}
                     placeholder="#color"
                     className="col-span-2 border rounded px-1 py-1" />
              <label className="col-span-2 text-xs flex items-center gap-1">
                <input type="checkbox" checked={!!b.alert_on_threshold}
                       onChange={(e) => updateBand(i, { alert_on_threshold: e.target.checked })} />
                alert
              </label>
              <button onClick={() => removeBand(i)}
                      className="col-span-1 text-red-600 text-xs hover:underline">×</button>
            </div>
          ))}
        </div>
        <button onClick={addBand}
                className="text-sm text-[#1f375d] hover:underline">+ Add band</button>
      </section>

      <section className="rounded border bg-white p-4 space-y-3">
        <h2 className="font-medium">Test scoring</h2>
        <div className="space-y-2">
          {questions.map((q, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate text-gray-600">{q.text || `Question ${i + 1}`}</span>
              {q.type === 'yes_no' ? (
                <select value={testAnswers[q.id] || ''}
                        onChange={(e) => setTestAnswers({ ...testAnswers, [q.id]: e.target.value })}
                        className="border rounded px-2 py-1 text-sm">
                  <option value="">—</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              ) : (
                <input type="number"
                       value={testAnswers[q.id] || ''}
                       onChange={(e) => setTestAnswers({ ...testAnswers, [q.id]: e.target.value })}
                       className="w-20 border rounded px-2 py-1 text-sm" />
              )}
            </div>
          ))}
        </div>
        <div className="text-sm border-t pt-3">
          Preview score: <span className="font-semibold">{previewScore.total}</span>
          {previewScore.band && (
            <span className="ml-2 px-2 py-0.5 rounded text-white text-xs"
                  style={{ backgroundColor: previewScore.band.color || '#1f375d' }}>
              {previewScore.band.label}
            </span>
          )}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving || !name.trim() || questions.some((q) => !q.text.trim())}
                className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50">
          {saving ? 'Saving…' : 'Save template'}
        </button>
      </div>
    </div>
  )
}
