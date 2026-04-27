// components/ehr/BiopsychosocialIntakeCard.tsx
//
// Wave 38 / TS8 — biopsychosocial intake card on the patient profile.
//
// One card. Renders an existing intake or prompts the therapist to
// start one. When the patient has zero progress notes (i.e. this is
// effectively the first appointment), the card shows a "Start intake"
// CTA prominently. Otherwise it sits collapsed with a short summary.

'use client'

import { useEffect, useState } from 'react'
import { ClipboardList, Save, Check, ChevronDown, ChevronUp } from 'lucide-react'

const SECTIONS: Array<{ key: string; label: string; helper: string }> = [
  { key: 'presenting_problem',           label: 'Presenting Problem',           helper: 'Why is the patient seeking help now?' },
  { key: 'history_of_present_illness',   label: 'History of Present Illness',   helper: 'Onset, duration, severity, course of current symptoms.' },
  { key: 'psychiatric_history',          label: 'Psychiatric History',          helper: 'Prior diagnoses, treatments, hospitalizations, medications.' },
  { key: 'medical_history',              label: 'Medical History',              helper: 'Chronic conditions, surgeries, current medications, allergies.' },
  { key: 'family_history',               label: 'Family History',               helper: 'Mental health and medical history of biological relatives.' },
  { key: 'social_history',               label: 'Social History',               helper: 'Living situation, relationships, education, employment, supports.' },
  { key: 'substance_use',                label: 'Substance Use',                helper: 'Alcohol, nicotine, cannabis, prescribed and recreational drugs.' },
  { key: 'trauma_history',               label: 'Trauma History',               helper: 'Past traumatic events and current impact (ask sensitively).' },
  { key: 'current_functioning',          label: 'Current Functioning',          helper: 'ADLs, work or school, sleep, appetite, social functioning.' },
  { key: 'mental_status_exam',           label: 'Mental Status Exam',           helper: 'Appearance, behavior, speech, mood, affect, thought, insight, judgment.' },
]

type Intake = Record<string, any> & {
  id?: string
  status?: 'draft' | 'completed' | 'amended'
  completed_at?: string | null
  updated_at?: string | null
}

export function BiopsychosocialIntakeCard({ patientId }: { patientId: string }) {
  const [intake, setIntake] = useState<Intake | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/ehr/biopsychosocial?patient_id=${encodeURIComponent(patientId)}`)
        if (!res.ok) { setIntake(null); return }
        const json = await res.json()
        if (cancelled) return
        const i = json.intake as Intake | null
        setIntake(i)
        if (i) {
          const seed: Record<string, string> = {}
          for (const s of SECTIONS) seed[s.key] = i[s.key] ?? ''
          setDraft(seed)
        } else {
          const seed: Record<string, string> = {}
          for (const s of SECTIONS) seed[s.key] = ''
          setDraft(seed)
        }
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [patientId])

  async function save(complete: boolean) {
    setSaving(true); setErr(null)
    try {
      const body: Record<string, any> = { patient_id: patientId, status: complete ? 'completed' : 'draft', ...draft }
      const res = await fetch('/api/ehr/biopsychosocial', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Save failed')
      setIntake({ ...(intake ?? {}), ...json.intake })
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  if (loading) return null

  const status = intake?.status ?? 'none'
  const filledCount = SECTIONS.filter((s) => (draft[s.key] ?? '').trim().length > 0).length

  return (
    <div className="bg-white border rounded-lg p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-gray-500" />
          Biopsychosocial intake
          {status === 'completed' && (
            <span className="text-xs font-normal bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 inline-flex items-center gap-1">
              <Check className="w-3 h-3" /> Completed
            </span>
          )}
          {status === 'draft' && (
            <span className="text-xs font-normal bg-amber-50 text-amber-800 border border-amber-200 rounded-full px-2 py-0.5">
              Draft · {filledCount}/{SECTIONS.length}
            </span>
          )}
          {status === 'none' && (
            <span className="text-xs font-normal bg-gray-50 text-gray-600 border border-gray-200 rounded-full px-2 py-0.5">
              Not started
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-xs text-teal-700 hover:text-teal-900 inline-flex items-center gap-1"
        >
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          {open ? 'Collapse' : status === 'none' ? 'Start intake' : 'Edit'}
        </button>
      </div>

      {!open && status === 'completed' && intake?.completed_at && (
        <p className="text-xs text-gray-500">
          Completed {new Date(intake.completed_at).toLocaleDateString()}.
        </p>
      )}

      {!open && status === 'draft' && (
        <p className="text-xs text-gray-500">
          Draft saved {intake?.updated_at ? new Date(intake.updated_at).toLocaleDateString() : ''}. {SECTIONS.length - filledCount} sections still empty.
        </p>
      )}

      {!open && status === 'none' && (
        <p className="text-xs text-gray-500">
          A structured 10-section intake is recommended for every new patient. Click <span className="font-medium">Start intake</span> to begin.
        </p>
      )}

      {open && (
        <div className="space-y-4 mt-2">
          {SECTIONS.map((s) => (
            <div key={s.key}>
              <label className="block text-sm font-medium text-gray-900">{s.label}</label>
              <p className="text-xs text-gray-500 mb-1">{s.helper}</p>
              <textarea
                rows={4}
                value={draft[s.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                placeholder=""
              />
            </div>
          ))}
          {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => save(false)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              Save draft
            </button>
            <button
              type="button"
              disabled={saving || filledCount === 0}
              onClick={() => save(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-teal-600 hover:bg-teal-700 text-white rounded-lg disabled:opacity-60"
            >
              <Check className="w-4 h-4" />
              Mark complete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
