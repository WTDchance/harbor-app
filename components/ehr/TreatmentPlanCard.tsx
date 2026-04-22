// components/ehr/TreatmentPlanCard.tsx
// Shows the patient's active treatment plan inline on the patient profile.
// Clicking "Open plan" jumps to the full editor at /dashboard/ehr/treatment-plans/[id].
// If no plan yet, offers to create one.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Target, Plus } from 'lucide-react'

type Goal = { id?: string; text: string; objectives?: Array<{ text: string }> }
type Plan = {
  id: string
  title: string
  presenting_problem: string | null
  diagnoses: string[]
  goals: Goal[]
  status: string
  start_date: string | null
  review_date: string | null
  signed_at: string | null
}

export function TreatmentPlanCard({ patientId }: { patientId: string }) {
  const router = useRouter()
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/ehr/treatment-plans?patient_id=${encodeURIComponent(patientId)}`)
        if (res.status === 403) { if (!cancelled) setEnabled(false); return }
        const json = await res.json()
        if (!cancelled) setPlans(json.plans || [])
      } catch { if (!cancelled) setPlans([]) }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [patientId])

  async function createBlank() {
    setCreating(true)
    try {
      const res = await fetch('/api/ehr/treatment-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, status: 'draft', goals: [] }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      router.push(`/dashboard/ehr/treatment-plans/${json.plan.id}`)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed')
      setCreating(false)
    }
  }

  if (!enabled) return null
  if (loading) return null

  const active = plans?.find((p) => p.status === 'active')
  const drafts = plans?.filter((p) => p.status === 'draft') ?? []

  return (
    <div className="bg-white border rounded-lg p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <Target className="w-4 h-4 text-gray-500" />
          Treatment Plan
        </h2>
        {!active && drafts.length === 0 && (
          <button
            onClick={createBlank}
            disabled={creating}
            className="inline-flex items-center gap-1.5 text-sm bg-teal-600 text-white px-3 py-1.5 rounded-md hover:bg-teal-700 transition disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            {creating ? 'Creating…' : 'Start plan'}
          </button>
        )}
      </div>

      {active ? (
        <div>
          <div className="text-sm font-medium text-gray-900">{active.title}</div>
          {active.presenting_problem && (
            <p className="text-xs text-gray-600 mt-1 line-clamp-2">{active.presenting_problem}</p>
          )}
          {active.diagnoses.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {active.diagnoses.map((d) => (
                <span key={d} className="px-2 py-0.5 text-[10px] font-medium bg-teal-50 text-teal-800 border border-teal-200 rounded-full">
                  {d}
                </span>
              ))}
            </div>
          )}
          <div className="mt-3 text-sm text-gray-700">
            {active.goals.length === 0 ? (
              <span className="text-gray-500 italic">No goals defined yet.</span>
            ) : (
              <ul className="space-y-1">
                {active.goals.slice(0, 3).map((g, i) => (
                  <li key={g.id ?? i} className="flex items-start gap-2">
                    <span className="mt-1 text-teal-600">•</span>
                    <span>{g.text}</span>
                  </li>
                ))}
                {active.goals.length > 3 && (
                  <li className="text-xs text-gray-500 ml-3">+ {active.goals.length - 3} more</li>
                )}
              </ul>
            )}
          </div>
          <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
            {active.start_date && <span>Started {formatDate(active.start_date)}</span>}
            {active.review_date && <span>Review by {formatDate(active.review_date)}</span>}
            {active.signed_at && <span className="text-emerald-700">Signed</span>}
          </div>
          <div className="mt-3">
            <Link
              href={`/dashboard/ehr/treatment-plans/${active.id}`}
              className="text-sm text-teal-700 hover:text-teal-900 font-medium"
            >
              Open plan →
            </Link>
          </div>
        </div>
      ) : drafts.length > 0 ? (
        <div>
          <p className="text-sm text-gray-600 mb-2">Draft treatment plan:</p>
          <Link
            href={`/dashboard/ehr/treatment-plans/${drafts[0].id}`}
            className="text-sm text-teal-700 hover:text-teal-900 font-medium"
          >
            Continue editing →
          </Link>
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          No treatment plan on file. Start one to document goals, diagnoses, and the planned frequency of care.
        </p>
      )}
    </div>
  )
}

function formatDate(d: string): string {
  const date = new Date(d)
  if (isNaN(date.getTime())) return d
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
