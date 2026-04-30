// W52 D2 — patient-facing assessment form.

'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface Question { id: string; text: string; scale: string; crisis_question?: boolean }

interface ScoringRules {
  scale_values?: Record<string, number>
  scale?: string
}

const FREQ_4_OPTIONS = ['Not at all', 'Several days', 'More than half the days', 'Nearly every day']
const SEV_5_OPTIONS  = ['Not at all', 'A little bit', 'Moderately', 'Quite a bit', 'Extremely']
const YES_NO        = ['Yes', 'No']
const AUDIT_C_Q1    = ['Never', 'Monthly or less', '2–4 times a month', '2–3 times a week', '4+ times a week']
const AUDIT_C_Q2    = ['1 or 2', '3 or 4', '5 or 6', '7 to 9', '10 or more']
const AUDIT_C_Q3    = ['Never', 'Less than monthly', 'Monthly', 'Weekly', 'Daily or almost daily']

function optionsFor(scale: string): string[] {
  switch (scale) {
    case 'frequency_4': return FREQ_4_OPTIONS
    case 'severity_5':  return SEV_5_OPTIONS
    case 'yes_no':      return YES_NO
    case 'audit_c_q1':  return AUDIT_C_Q1
    case 'audit_c_q2':  return AUDIT_C_Q2
    case 'audit_c_q3':  return AUDIT_C_Q3
    default: return FREQ_4_OPTIONS
  }
}

export default function PortalAssessmentPage() {
  const params = useParams<{ token: string }>()
  const token = params.token
  const [meta, setMeta] = useState<any>(null)
  const [responses, setResponses] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [doneMeta, setDoneMeta] = useState<any>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/portal/assessments/${token}`)
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return
        if (!ok) {
          setError(j.error === 'expired' ? 'This assessment has expired.'
            : j.error === 'not_found' ? 'Invalid link.' : 'Could not load.')
        } else {
          setMeta(j)
          if (j.administration?.status === 'completed') setDone(true)
        }
      })
      .finally(() => setLoading(false))
    return () => { cancelled = true }
  }, [token])

  async function submit() {
    if (!meta) return
    setSubmitting(true); setError(null)
    try {
      const payload = (meta.definition.questions as Question[]).map(q => ({
        question_id: q.id,
        value: responses[q.id] ?? '',
      }))
      const r = await fetch(`/api/portal/assessments/${token}/submit`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ responses: payload }),
      })
      const j = await r.json()
      if (!r.ok) setError(j.error || 'Submission failed')
      else { setDoneMeta(j); setDone(true) }
    } finally { setSubmitting(false) }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">Loading…</div>
  if (error || !meta) return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md text-center bg-white border border-red-200 rounded-xl p-8">
        <h1 className="text-lg font-semibold text-red-700">Cannot open assessment</h1>
        <p className="text-sm text-gray-600 mt-2">{error}</p>
      </div>
    </div>
  )

  if (done) {
    const crisis = doneMeta?.crisis_flagged
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className={`max-w-md text-center bg-white border rounded-xl p-8 ${crisis ? 'border-red-300' : 'border-green-200'}`}>
          <h1 className={`text-lg font-semibold ${crisis ? 'text-red-700' : 'text-green-700'}`}>
            {crisis ? 'Submitted — provider notified' : 'Submitted — thank you'}
          </h1>
          <p className="text-sm text-gray-600 mt-2">Your responses were sent to {meta.practice?.name ?? 'your provider'}.</p>
          {crisis && (
            <div className="mt-4 text-xs text-red-700">
              If you're in crisis, please call or text <strong>988</strong> (US Suicide & Crisis Lifeline) or 911.
            </div>
          )}
        </div>
      </div>
    )
  }

  const def = meta.definition
  const questions: Question[] = def.questions ?? []
  const allAnswered = questions.every(q => responses[q.id])

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-xl border border-gray-200 p-6 sm:p-8">
        <div className="text-xs uppercase tracking-wide text-gray-500">{meta.practice?.name}</div>
        <h1 className="text-2xl font-semibold text-gray-900 mt-1">{def.name}</h1>
        {def.short_description && <p className="text-sm text-gray-600 mt-1">{def.short_description}</p>}

        <div className="mt-6 space-y-5">
          {questions.map((q, i) => {
            const opts = optionsFor(q.scale)
            return (
              <div key={q.id} className="border-b pb-4">
                <div className="text-sm font-medium text-gray-900">
                  <span className="text-gray-400 mr-1">{i + 1}.</span>{q.text}
                </div>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {opts.map(o => (
                    <label key={o} className="flex items-center gap-2 text-sm">
                      <input type="radio" name={q.id} value={o}
                        checked={responses[q.id] === o}
                        onChange={() => setResponses(s => ({ ...s, [q.id]: o }))} />
                      {o}
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

        <button onClick={submit} disabled={!allAnswered || submitting}
          className="mt-6 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </div>
  )
}
