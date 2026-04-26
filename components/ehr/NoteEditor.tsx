// components/ehr/NoteEditor.tsx
// Client-side form for creating / editing a progress note.
// Used by both the "new" page and the edit view on the detail page.

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CodePicker } from '@/components/ehr/CodePicker'
import { CPT_CODES, ICD10_CODES } from '@/lib/ehr/codes'
import { Target } from 'lucide-react'

type Patient = { id: string; first_name: string; last_name: string }

export type NoteFormValue = {
  id?: string
  patient_id: string
  title: string
  note_format: 'soap' | 'dap' | 'birp' | 'freeform'
  subjective?: string | null
  objective?: string | null
  assessment?: string | null
  plan?: string | null
  body?: string | null
  cpt_codes?: string[]
  icd10_codes?: string[]
  linked_goal_ids?: string[]
  appointment_id?: string | null
  status?: string
}

type PlanGoal = { id: string; text: string }

type Props = {
  patients: Patient[]
  initial?: NoteFormValue
  mode: 'create' | 'edit'
}

export function NoteEditor({ patients, initial, mode }: Props) {
  const router = useRouter()

  const [form, setForm] = useState<NoteFormValue>(
    initial ?? {
      patient_id: patients[0]?.id ?? '',
      title: '',
      note_format: 'soap',
      subjective: '',
      objective: '',
      assessment: '',
      plan: '',
      body: '',
      cpt_codes: [],
      icd10_codes: [],
    },
  )
  const [cptCodes, setCptCodes] = useState<string[]>(initial?.cpt_codes ?? [])
  const [icdCodes, setIcdCodes] = useState<string[]>(initial?.icd10_codes ?? [])
  const [linkedGoalIds, setLinkedGoalIds] = useState<string[]>(initial?.linked_goal_ids ?? [])
  const [planGoals, setPlanGoals] = useState<PlanGoal[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load the patient's active treatment plan so we can show goal checkboxes.
  useEffect(() => {
    if (!form.patient_id) { setPlanGoals(null); return }
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/ehr/treatment-plans?patient_id=${encodeURIComponent(form.patient_id)}`)
        if (!res.ok) return
        const json = await res.json()
        const active = (json.plans || []).find((p: any) => p.status === 'active')
        if (!cancelled) {
          const goals: PlanGoal[] = (active?.goals || [])
            .filter((g: any) => g?.id && g?.text)
            .map((g: any) => ({ id: g.id, text: g.text }))
          setPlanGoals(goals)
        }
      } catch {}
    }
    load()
    return () => { cancelled = true }
  }, [form.patient_id])

  function toggleGoal(id: string) {
    setLinkedGoalIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])
  }

  const isLocked = initial?.status === 'signed' || initial?.status === 'amended'

  function update<K extends keyof NoteFormValue>(k: K, v: NoteFormValue[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const payload: any = {
        ...form,
        cpt_codes: cptCodes,
        icd10_codes: icdCodes,
        linked_goal_ids: linkedGoalIds,
      }

      const url = mode === 'edit' && initial?.id ? `/api/ehr/notes/${initial.id}` : '/api/ehr/notes'
      const method = mode === 'edit' ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Save failed')

      const noteId = mode === 'edit' ? initial!.id : json.note.id
      router.push(`/dashboard/ehr/notes/${noteId}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Patient</label>
          <select
            disabled={isLocked || mode === 'edit'}
            value={form.patient_id}
            onChange={(e) => update('patient_id', e.target.value)}
            required
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
          >
            {patients.length === 0 && <option value="">No patients yet</option>}
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.first_name} {p.last_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Format</label>
          <select
            disabled={isLocked}
            value={form.note_format}
            onChange={(e) => update('note_format', e.target.value as NoteFormValue['note_format'])}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
          >
            <option value="soap">SOAP</option>
            <option value="dap">DAP</option>
            <option value="birp">BIRP</option>
            <option value="freeform">Freeform</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
        <input
          disabled={isLocked}
          type="text"
          value={form.title}
          onChange={(e) => update('title', e.target.value)}
          required
          placeholder="e.g. Session 3 — anxiety follow-up"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
        />
      </div>

      {form.note_format !== 'freeform' ? (
        <div className="space-y-4">
          <SectionField
            label={sectionLabel(form.note_format, 0)}
            value={form.subjective ?? ''}
            onChange={(v) => update('subjective', v)}
            disabled={isLocked}
          />
          <SectionField
            label={sectionLabel(form.note_format, 1)}
            value={form.objective ?? ''}
            onChange={(v) => update('objective', v)}
            disabled={isLocked}
          />
          <SectionField
            label={sectionLabel(form.note_format, 2)}
            value={form.assessment ?? ''}
            onChange={(v) => update('assessment', v)}
            disabled={isLocked}
          />
          <SectionField
            label={sectionLabel(form.note_format, 3)}
            value={form.plan ?? ''}
            onChange={(v) => update('plan', v)}
            disabled={isLocked}
          />
        </div>
      ) : (
        <SectionField
          label="Note"
          value={form.body ?? ''}
          onChange={(v) => update('body', v)}
          rows={12}
          disabled={isLocked}
        />
      )}

      {planGoals && planGoals.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
            <Target className="w-4 h-4 text-gray-500" />
            Goals addressed in this session
          </label>
          <p className="text-xs text-gray-500 mb-2">
            Check any treatment-plan goals this note advanced. Rolls up into goal-progress views.
          </p>
          <div className="space-y-1.5 border border-gray-200 rounded-lg p-3 bg-gray-50">
            {planGoals.map((g) => (
              <label key={g.id} className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  disabled={isLocked}
                  checked={linkedGoalIds.includes(g.id)}
                  onChange={() => toggleGoal(g.id)}
                  className="mt-1 rounded text-teal-600 focus:ring-teal-500 disabled:opacity-50"
                />
                <span className="text-gray-800">{g.text}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CodePicker
          label="CPT codes"
          hint="procedure"
          options={CPT_CODES}
          value={cptCodes}
          onChange={setCptCodes}
          disabled={isLocked}
          placeholder="Type 90 or 'intake'…"
        />
        <CodePicker
          label="ICD-10 codes"
          hint="diagnosis"
          options={ICD10_CODES}
          value={icdCodes}
          onChange={setIcdCodes}
          disabled={isLocked}
          placeholder="Type F41 or 'anxiety'…"
        />
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100"
        >
          Cancel
        </button>
        {!isLocked && (
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
          >
            {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create note'}
          </button>
        )}
      </div>
    </form>
  )
}

function SectionField(props: {
  label: string
  value: string
  onChange: (v: string) => void
  rows?: number
  disabled?: boolean
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{props.label}</label>
      <textarea
        disabled={props.disabled}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        rows={props.rows ?? 4}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
      />
    </div>
  )
}

function sectionLabel(format: NoteFormValue['note_format'], index: number): string {
  const maps: Record<string, string[]> = {
    soap: ['Subjective', 'Objective', 'Assessment', 'Plan'],
    dap: ['Data', '—', 'Assessment', 'Plan'],
    birp: ['Behavior', 'Intervention', 'Response', 'Plan'],
  }
  return maps[format]?.[index] ?? ''
}
