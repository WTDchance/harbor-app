'use client'

// Wave 39 / Task 1 — single MSE editor.
//
// Phone-friendly: each domain is its own labelled textarea on its own
// row, ≥44px row height, sticky save bar at the bottom. Save button
// PATCHes the draft. Complete button locks the exam (irreversible).

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Save, Check } from 'lucide-react'

const DOMAINS: Array<{ key: string; label: string; helper: string }> = [
  { key: 'appearance',       label: 'Appearance',       helper: 'Grooming, hygiene, dress, posture, eye contact.' },
  { key: 'behavior',         label: 'Behavior',         helper: 'Activity level, cooperation, eye contact, mannerisms.' },
  { key: 'speech',           label: 'Speech',           helper: 'Rate, volume, articulation, prosody.' },
  { key: 'mood',             label: 'Mood (subjective)', helper: 'Quote the patient verbatim if possible.' },
  { key: 'affect',           label: 'Affect (objective)', helper: 'Range, intensity, congruence with mood.' },
  { key: 'thought_process',  label: 'Thought process',  helper: 'Logical, tangential, circumstantial, blocking, etc.' },
  { key: 'thought_content',  label: 'Thought content',  helper: 'Themes, preoccupations, SI/HI, delusions, paranoia.' },
  { key: 'perception',       label: 'Perception',       helper: 'Hallucinations, illusions, dissociation.' },
  { key: 'cognition',        label: 'Cognition',        helper: 'Orientation x4, attention, memory, fund of knowledge.' },
  { key: 'insight',          label: 'Insight',          helper: 'Awareness of illness and need for treatment.' },
  { key: 'judgment',         label: 'Judgment',         helper: 'Decision-making, impulse control.' },
]

interface Exam {
  id: string
  patient_id: string
  status: 'draft' | 'completed' | 'amended'
  administered_at: string
  completed_at: string | null
  summary: string | null
  [key: string]: unknown
}

export default function MseEditor() {
  const params = useParams()
  const router = useRouter()
  const patientId = String(params.id)
  const mseId = String(params.mseId)

  const [exam, setExam] = useState<Exam | null>(null)
  const [domains, setDomains] = useState<Record<string, string>>({})
  const [summary, setSummary] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/ehr/patients/${patientId}/mse/${mseId}`, { credentials: 'include' })
      if (!res.ok) {
        setError(`Could not load exam (${res.status})`)
        return
      }
      const { exam: e } = await res.json()
      setExam(e)
      const next: Record<string, string> = {}
      for (const d of DOMAINS) next[d.key] = (e?.[d.key] as string) ?? ''
      setDomains(next)
      setSummary((e?.summary as string) ?? '')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [mseId])

  const isLocked = exam?.status === 'completed' || exam?.status === 'amended'

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { summary, ...domains }
      const res = await fetch(`/api/ehr/patients/${patientId}/mse/${mseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error?.message || `Save failed (${res.status})`)
        return
      }
      const { exam: updated } = await res.json()
      setExam(updated)
      setSavedAt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
    } catch (err: any) {
      setError(err?.message || 'Network error')
    } finally {
      setSaving(false)
    }
  }

  async function complete() {
    if (!confirm('Mark this MSE complete? Completed exams cannot be edited — further changes require an amendment.')) return
    setCompleting(true)
    setError(null)
    try {
      // Save first to capture latest edits.
      await save()
      const res = await fetch(`/api/ehr/patients/${patientId}/mse/${mseId}/complete`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error?.message || `Complete failed (${res.status})`)
        return
      }
      const { exam: updated } = await res.json()
      setExam(updated)
    } catch (err: any) {
      setError(err?.message || 'Network error')
    } finally {
      setCompleting(false)
    }
  }

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </main>
    )
  }

  return (
    <main className="flex-1 max-w-3xl mx-auto w-full pb-32">
      <div className="px-4 pt-4">
        <Link
          href={`/dashboard/patients/${patientId}/mse`}
          className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-800"
          style={{ minHeight: 44 }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to MSE list
        </Link>
        <div className="flex items-center justify-between mt-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Mental Status Exam</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Administered {exam ? new Date(exam.administered_at).toLocaleString() : '—'}
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
              exam?.status === 'completed' ? 'bg-green-100 text-green-800' :
              exam?.status === 'amended'   ? 'bg-amber-100 text-amber-800' :
                                              'bg-gray-100 text-gray-700'
            }`}
          >
            {exam?.status ?? 'unknown'}
          </span>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="mt-4 px-4 space-y-4">
        {DOMAINS.map((d) => (
          <div key={d.key} className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="block text-sm font-semibold text-gray-900">{d.label}</label>
            <p className="text-xs text-gray-500 mt-0.5 mb-2">{d.helper}</p>
            <textarea
              value={domains[d.key] ?? ''}
              onChange={(e) => setDomains((prev) => ({ ...prev, [d.key]: e.target.value }))}
              disabled={isLocked}
              rows={3}
              className="w-full p-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50 disabled:text-gray-700"
              style={{ minHeight: 72 }}
            />
          </div>
        ))}

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="block text-sm font-semibold text-gray-900">Clinical summary</label>
          <p className="text-xs text-gray-500 mt-0.5 mb-2">Overall impression and any notable findings.</p>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            disabled={isLocked}
            rows={4}
            className="w-full p-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50 disabled:text-gray-700"
            style={{ minHeight: 96 }}
          />
        </div>
      </div>

      {!isLocked && (
        <div
          className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-3 z-30"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 12px)' }}
        >
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-2 px-1">
            <div className="text-xs text-gray-500">
              {savedAt ? `Saved at ${savedAt}` : 'Not saved yet'}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={save}
                disabled={saving || completing}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-60"
                style={{ minHeight: 44 }}
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving…' : 'Save draft'}
              </button>
              <button
                onClick={complete}
                disabled={saving || completing}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-60"
                style={{ minHeight: 44 }}
              >
                <Check className="w-4 h-4" />
                {completing ? 'Completing…' : 'Mark complete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
