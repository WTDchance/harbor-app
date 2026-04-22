// components/ehr/SafetyPlanCard.tsx
// Prominent card on the patient profile when a safety plan exists, or a
// compact "Create safety plan" affordance when one doesn't. Safety plans
// are high-importance clinical tools — when present, the card uses red
// border to surface visibility.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ShieldAlert, Plus } from 'lucide-react'

type SafetyPlan = {
  id: string
  status: string
  warning_signs: string[]
  reasons_for_living: string[]
  updated_at: string
}

export function SafetyPlanCard({ patientId }: { patientId: string }) {
  const router = useRouter()
  const [plan, setPlan] = useState<SafetyPlan | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/ehr/safety-plans?patient_id=${encodeURIComponent(patientId)}`)
        if (res.status === 403) { if (!cancelled) setEnabled(false); return }
        const json = await res.json()
        const active = (json.plans || []).find((p: any) => p.status === 'active')
        if (!cancelled) setPlan(active || null)
      } catch {}
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [patientId])

  async function create() {
    setCreating(true)
    try {
      const res = await fetch('/api/ehr/safety-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, status: 'draft' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      router.push(`/dashboard/ehr/safety-plans/${json.plan.id}`)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed')
      setCreating(false)
    }
  }

  if (!enabled) return null
  if (loading) return null

  if (plan) {
    return (
      <div className="bg-red-50 border border-red-300 rounded-lg p-5 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-red-900 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" />
            Active Safety Plan
          </h2>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-red-700 bg-red-100 border border-red-200 px-2 py-0.5 rounded-full">
            active
          </span>
        </div>
        <p className="text-xs text-red-800 mb-3">
          This patient has a Stanley-Brown safety plan on file. Review before each session.
        </p>
        {plan.warning_signs.length > 0 && (
          <div className="text-xs text-red-900 mb-2">
            <span className="font-medium">Warning signs:</span>{' '}
            {plan.warning_signs.slice(0, 3).join(', ')}
            {plan.warning_signs.length > 3 && ' …'}
          </div>
        )}
        <Link
          href={`/dashboard/ehr/safety-plans/${plan.id}`}
          className="text-sm text-red-700 hover:text-red-900 font-medium"
        >
          Open safety plan →
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-white border rounded-lg p-5 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-gray-500" />
          Safety Plan
        </h2>
        <button
          onClick={create}
          disabled={creating}
          className="inline-flex items-center gap-1.5 text-sm bg-white border border-red-600 text-red-700 px-3 py-1.5 rounded-md hover:bg-red-50 transition disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" />
          {creating ? 'Creating…' : 'Create safety plan'}
        </button>
      </div>
      <p className="text-sm text-gray-500">
        No safety plan on file. Create one if the patient presents with suicidality or significant self-harm risk.
      </p>
    </div>
  )
}
