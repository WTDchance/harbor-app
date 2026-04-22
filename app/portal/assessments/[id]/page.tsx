// app/portal/assessments/[id]/page.tsx
// Patient fills out an assessment. Client-rendered — we fetch the instrument
// definition + current state, render the questions, validate completeness,
// submit, and show the score + severity + any alerts immediately.

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, AlertTriangle, ChevronLeft, Clock } from 'lucide-react'

type Option = { value: number; label: string }
type Question = { id: string; text: string; options: Option[] }
type Instrument = {
  id: string
  name: string
  description: string
  instructions: string
  estimated_minutes: number
  max_score: number
  questions: Question[]
}
type AssessmentRow = {
  id: string
  assessment_type: string
  status: string
  score: number | null
  severity: string | null
  completed_at: string | null
}
type GetResponse = { instrument: Instrument; assessment: AssessmentRow }

export default function PortalAssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [data, setData] = useState<GetResponse | null>(null)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ score: number; severity: { label: string; color: string }; alerts: any[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [id, setId] = useState<string>('')

  useEffect(() => {
    (async () => {
      const p = await params
      setId(p.id)
      try {
        const res = await fetch(`/api/portal/assessments/${p.id}`)
        if (res.status === 401) { router.replace('/portal/login'); return }
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Failed to load')
        setData(json)
        if (json.assessment?.responses_json) setAnswers(json.assessment.responses_json)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally { setLoading(false) }
    })()
  }, [params, router])

  async function submit() {
    if (!data) return
    const missing = data.instrument.questions.find((q) => typeof answers[q.id] !== 'number')
    if (missing) { setError('Please answer every question before submitting.'); return }
    setSubmitting(true); setError(null)
    try {
      const res = await fetch(`/api/portal/assessments/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Submission failed')
      setResult({ score: json.score, severity: json.severity, alerts: json.alerts || [] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed')
    } finally { setSubmitting(false) }
  }

  if (loading) return <div className="max-w-2xl mx-auto p-8 text-sm text-gray-500">Loading…</div>
  if (error && !data) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">{error}</div>
      </div>
    )
  }
  if (!data) return null

  // Completed / showing result state
  if (result || data.assessment.status === 'completed') {
    const finalScore = result?.score ?? data.assessment.score
    const severityLabel = result?.severity?.label ?? data.assessment.severity
    const severityColor = result?.severity?.color
    const alerts = result?.alerts ?? []

    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center gap-2 text-emerald-700 mb-3">
            <CheckCircle2 className="w-6 h-6" />
            <h1 className="text-lg font-semibold">Thank you — your responses have been sent to your therapist.</h1>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500">Score</div>
              <div className="text-2xl font-bold text-gray-900">{finalScore}<span className="text-sm font-normal text-gray-500"> / {data.instrument.max_score}</span></div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500">Result</div>
              <div className={`text-lg font-semibold ${
                severityColor === 'green' ? 'text-emerald-700'
                : severityColor === 'amber' ? 'text-amber-700'
                : severityColor === 'orange' ? 'text-orange-700'
                : severityColor === 'red' ? 'text-red-700'
                : 'text-gray-900'
              }`}>{severityLabel}</div>
            </div>
          </div>
          {alerts.length > 0 && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="text-sm text-red-900">
                  <p className="font-semibold mb-1">Your therapist has been notified.</p>
                  <p>If you are having thoughts of harming yourself or feel unsafe, please reach out now:</p>
                  <ul className="list-disc ml-5 mt-2 text-sm">
                    <li><strong>988</strong> — Suicide &amp; Crisis Lifeline (call or text, 24/7)</li>
                    <li><strong>911</strong> — or go to your nearest emergency room</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
          <Link
            href="/portal/home"
            className="mt-6 inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-900 font-medium"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to portal
          </Link>
        </div>
      </div>
    )
  }

  // Questionnaire form
  const answered = Object.keys(answers).length
  const total = data.instrument.questions.length

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/portal/home" className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-900 mb-4">
        <ChevronLeft className="w-4 h-4" />
        Back to portal
      </Link>

      <h1 className="text-2xl font-semibold text-gray-900 mb-1">{data.instrument.name}</h1>
      <p className="text-sm text-gray-600 mb-2">{data.instrument.description}</p>
      <div className="flex items-center gap-3 text-xs text-gray-500 mb-6">
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> About {data.instrument.estimated_minutes} minute{data.instrument.estimated_minutes === 1 ? '' : 's'}</span>
        <span>{answered} of {total} answered</span>
      </div>

      <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 text-sm text-teal-900 mb-6">
        {data.instrument.instructions}
      </div>

      <div className="space-y-6">
        {data.instrument.questions.map((q, idx) => (
          <div key={q.id} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-sm font-medium text-gray-900 mb-3">
              {idx + 1}. {q.text}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {q.options.map((opt) => {
                const selected = answers[q.id] === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setAnswers((a) => ({ ...a, [q.id]: opt.value }))}
                    className={`text-left px-3 py-2 rounded-lg border text-sm transition ${
                      selected
                        ? 'border-teal-600 bg-teal-50 text-teal-900 font-medium'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-teal-500 hover:bg-teal-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

      <div className="mt-6 flex items-center justify-between gap-2 sticky bottom-4 bg-white border border-gray-200 rounded-xl p-3 shadow-sm">
        <div className="text-sm text-gray-600">
          {answered === total ? (
            <span className="text-emerald-700 font-medium">All questions answered.</span>
          ) : (
            <>Progress: <strong>{answered}</strong>/{total}</>
          )}
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || answered < total}
          className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit responses'}
        </button>
      </div>
    </div>
  )
}
