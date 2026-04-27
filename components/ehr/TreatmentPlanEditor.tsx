// components/ehr/TreatmentPlanEditor.tsx
// Interactive treatment-plan editor. Handles presenting problem, diagnoses
// (via CodePicker), goals + objectives, frequency, dates, and status.

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, CheckCircle2 } from 'lucide-react'
import { CodePicker } from './CodePicker'
import { SmartCodePicker } from './SmartCodePicker'
import { ICD10_CODES } from '@/lib/ehr/codes'

type Goal = {
  id: string
  text: string
  target_date?: string
  objectives: Array<{ id: string; text: string; interventions: string[] }>
}

type Plan = {
  id: string
  title: string
  presenting_problem: string | null
  diagnoses: string[]
  goals: Goal[]
  frequency: string | null
  start_date: string | null
  review_date: string | null
  status: string
}

function uid(): string { return Math.random().toString(36).slice(2, 10) }

export function TreatmentPlanEditor({ initial, patientId }: { initial: Plan; patientId?: string }) {
  const router = useRouter()
  const [plan, setPlan] = useState<Plan>({
    ...initial,
    goals: (initial.goals || []).map((g: any) => ({
      id: g.id || uid(),
      text: g.text || '',
      target_date: g.target_date,
      objectives: (g.objectives || []).map((o: any) => ({
        id: o.id || uid(),
        text: o.text || '',
        interventions: Array.isArray(o.interventions) ? o.interventions : [],
      })),
    })),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const isLocked = plan.status === 'archived' || plan.status === 'completed'

  function setField<K extends keyof Plan>(k: K, v: Plan[K]) {
    setPlan((p) => ({ ...p, [k]: v }))
  }

  function addGoal() {
    setPlan((p) => ({ ...p, goals: [...p.goals, { id: uid(), text: '', objectives: [] }] }))
  }

  function updateGoal(id: string, patch: Partial<Goal>) {
    setPlan((p) => ({ ...p, goals: p.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) }))
  }

  function removeGoal(id: string) {
    setPlan((p) => ({ ...p, goals: p.goals.filter((g) => g.id !== id) }))
  }

  function addObjective(goalId: string) {
    setPlan((p) => ({
      ...p,
      goals: p.goals.map((g) =>
        g.id === goalId
          ? { ...g, objectives: [...g.objectives, { id: uid(), text: '', interventions: [] }] }
          : g,
      ),
    }))
  }

  function updateObjective(goalId: string, objId: string, text: string) {
    setPlan((p) => ({
      ...p,
      goals: p.goals.map((g) =>
        g.id === goalId
          ? { ...g, objectives: g.objectives.map((o) => (o.id === objId ? { ...o, text } : o)) }
          : g,
      ),
    }))
  }

  function removeObjective(goalId: string, objId: string) {
    setPlan((p) => ({
      ...p,
      goals: p.goals.map((g) =>
        g.id === goalId ? { ...g, objectives: g.objectives.filter((o) => o.id !== objId) } : g,
      ),
    }))
  }

  async function save(nextStatus?: 'active' | 'draft') {
    setSaving(true); setError(null)
    try {
      const payload: any = {
        title: plan.title,
        presenting_problem: plan.presenting_problem,
        diagnoses: plan.diagnoses,
        goals: plan.goals,
        frequency: plan.frequency,
        start_date: plan.start_date,
        review_date: plan.review_date,
      }
      if (nextStatus) payload.status = nextStatus
      const res = await fetch(`/api/ehr/treatment-plans/${plan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Save failed')
      if (nextStatus) setPlan((p) => ({ ...p, status: nextStatus }))
      setToast(nextStatus === 'active' ? 'Plan activated' : 'Saved')
      setTimeout(() => setToast(null), 2000)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
        <input
          disabled={isLocked}
          value={plan.title}
          onChange={(e) => setField('title', e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Presenting problem</label>
        <textarea
          disabled={isLocked}
          value={plan.presenting_problem ?? ''}
          onChange={(e) => setField('presenting_problem', e.target.value)}
          rows={3}
          placeholder="Why the patient is seeking treatment, in plain clinical language."
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
        />
      </div>

      <SmartCodePicker
        label="Working diagnoses (ICD-10)"
        hint="AI suggests top 3 based on patient's intake + assessments"
        options={ICD10_CODES}
        value={plan.diagnoses}
        onChange={(v) => setField('diagnoses', v)}
        disabled={isLocked}
        patientId={patientId}
      />

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">Goals and objectives</label>
          {!isLocked && (
            <button
              type="button"
              onClick={addGoal}
              className="inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-900 font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              Add goal
            </button>
          )}
        </div>
        {plan.goals.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No goals yet. Add at least one.</p>
        ) : (
          <div className="space-y-4">
            {plan.goals.map((g, gi) => (
              <div key={g.id} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <span className="text-sm font-semibold text-teal-700 mt-1.5">{gi + 1}.</span>
                  <input
                    disabled={isLocked}
                    value={g.text}
                    onChange={(e) => updateGoal(g.id, { text: e.target.value })}
                    placeholder="Goal — what the patient will achieve"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
                  />
                  {!isLocked && (
                    <button
                      type="button"
                      onClick={() => removeGoal(g.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600"
                      title="Remove goal"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="mt-2 ml-7 space-y-1.5">
                  {g.objectives.map((o, oi) => (
                    <div key={o.id} className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-10">{gi + 1}.{oi + 1}</span>
                      <input
                        disabled={isLocked}
                        value={o.text}
                        onChange={(e) => updateObjective(g.id, o.id, e.target.value)}
                        placeholder="Objective — a measurable step"
                        className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
                      />
                      {!isLocked && (
                        <button
                          type="button"
                          onClick={() => removeObjective(g.id, o.id)}
                          className="p-1 text-gray-400 hover:text-red-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  {!isLocked && (
                    <button
                      type="button"
                      onClick={() => addObjective(g.id)}
                      className="text-xs text-teal-700 hover:text-teal-900 font-medium"
                    >
                      + Add objective
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Frequency</label>
          <input
            disabled={isLocked}
            value={plan.frequency ?? ''}
            onChange={(e) => setField('frequency', e.target.value)}
            placeholder="Weekly individual, 45 min"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Start date</label>
          <input
            disabled={isLocked}
            type="date"
            value={plan.start_date ?? ''}
            onChange={(e) => setField('start_date', e.target.value || null)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Review date</label>
          <input
            disabled={isLocked}
            type="date"
            value={plan.review_date ?? ''}
            onChange={(e) => setField('review_date', e.target.value || null)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
          />
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}
      {toast && <div className="text-sm text-emerald-700">{toast}</div>}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={() => save()}
          disabled={saving || isLocked}
          className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save draft'}
        </button>
        {plan.status !== 'active' && !isLocked && (
          <button
            type="button"
            onClick={() => save('active')}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            {saving ? 'Activating…' : 'Activate plan'}
          </button>
        )}
      </div>
    </div>
  )
}
