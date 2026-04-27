// components/ehr/SmartGoalSuggestions.tsx
//
// Wave 33 — AI-suggested treatment plan goals. Sits above the goals
// section in the TreatmentPlanEditor. Sonnet reads the patient's
// diagnoses + intake + assessments and proposes 3 evidence-anchored
// goals (each with 2-3 candidate objectives). Therapist clicks to
// add any of them in one tap, then edits inline.

'use client'

import { useState, useEffect } from 'react'
import { Sparkles, Plus, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'

type SuggestedGoal = {
  text: string
  rationale: string
  objectives: string[]
}

type Props = {
  patientId: string
  diagnoses: string[]
  disabled?: boolean
  onAdd: (goal: { text: string; objectives: { text: string; interventions: string[] }[] }) => void
}

export function SmartGoalSuggestions(props: Props) {
  const { patientId, diagnoses, disabled, onAdd } = props
  const [open, setOpen] = useState(true)
  const [goals, setGoals] = useState<SuggestedGoal[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [regen, setRegen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<number>>(new Set())

  async function load() {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (diagnoses.length) params.set('diagnoses', diagnoses.join(','))
      const r = await fetch(`/api/ehr/patients/${patientId}/suggested-goals?${params.toString()}`)
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      const j = await r.json()
      setGoals(j.goals || [])
      setAdded(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load suggestions')
    } finally {
      setLoading(false)
    }
  }

  async function regenerate() {
    setRegen(true)
    setError(null)
    try {
      const r = await fetch(`/api/ehr/patients/${patientId}/suggested-goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diagnoses }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      const j = await r.json()
      setGoals(j.goals || [])
      setAdded(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate')
    } finally {
      setRegen(false)
    }
  }

  useEffect(() => {
    if (open && goals === null) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patientId])

  function handleAdd(i: number, g: SuggestedGoal) {
    onAdd({
      text: g.text,
      objectives: g.objectives.map(o => ({ text: o, interventions: [] })),
    })
    setAdded(prev => {
      const next = new Set(prev)
      next.add(i)
      return next
    })
  }

  return (
    <div className="bg-gradient-to-br from-teal-50 via-white to-teal-50 border border-teal-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-teal-100/50 transition"
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-teal-600 flex items-center justify-center text-white">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <span className="font-medium text-sm text-teal-900">
            AI-suggested goals based on this patient's data
          </span>
        </div>
        <div className="flex items-center gap-2">
          {open && goals && !loading && !regen && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); regenerate() }}
              className="text-xs text-teal-700 hover:text-teal-900 inline-flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              Regenerate
            </button>
          )}
          {open ? <ChevronUp className="w-4 h-4 text-teal-700" /> : <ChevronDown className="w-4 h-4 text-teal-700" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4">
          {(loading || regen) && (
            <div className="text-sm text-teal-800 py-2 flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              {regen ? 'Regenerating with current data…' : 'Reading the patient record…'}
            </div>
          )}

          {error && (
            <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mb-2">
              {error}
              {error.includes('daily_cap') && <div className="text-xs mt-1">Per-practice daily AI cap reached. Resets at UTC midnight.</div>}
            </div>
          )}

          {!loading && !regen && diagnoses.length === 0 && (
            <div className="text-xs text-teal-800 italic">
              Tip: pick at least one working diagnosis above first — the suggestions get sharper.
            </div>
          )}

          {!loading && !regen && goals && goals.length === 0 && (
            <div className="text-sm text-gray-600 italic">No suggestions yet — try once you have intake data + a diagnosis.</div>
          )}

          {!loading && !regen && goals && goals.length > 0 && (
            <div className="space-y-2">
              {goals.map((g, i) => (
                <div
                  key={i}
                  className="bg-white border border-teal-200 rounded-lg p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 font-medium leading-snug">{g.text}</p>
                      {g.rationale && (
                        <p className="text-xs text-gray-500 italic mt-1">{g.rationale}</p>
                      )}
                      {g.objectives.length > 0 && (
                        <ul className="mt-2 space-y-0.5">
                          {g.objectives.map((o, j) => (
                            <li key={j} className="text-xs text-gray-700 pl-3 relative">
                              <span className="absolute left-0 text-teal-600">•</span>
                              {o}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {!disabled && (
                      <button
                        type="button"
                        onClick={() => handleAdd(i, g)}
                        disabled={added.has(i)}
                        className={`flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg ${
                          added.has(i)
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-teal-600 text-white hover:bg-teal-700'
                        }`}
                      >
                        <Plus className="w-3 h-3" />
                        {added.has(i) ? 'Added' : 'Add to plan'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="text-xs text-teal-700/70 mt-2 italic">
            Suggestions inform — they don't decide. Edit freely after adding.
          </div>
        </div>
      )}
    </div>
  )
}
