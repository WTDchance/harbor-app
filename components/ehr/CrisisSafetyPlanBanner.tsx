// components/ehr/CrisisSafetyPlanBanner.tsx
//
// Wave 38 / TS10 — surfaces a red banner at the top of the patient
// profile when:
//   - patient.risk_level === 'high' (or 'crisis')
//   - AND there is no active safety plan, OR all six Stanley-Brown
//     section text fields are empty on the active plan.
//
// One ask: build the safety plan before this session ends.

'use client'

import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'

type RiskLevel = 'none' | 'low' | 'moderate' | 'high' | 'crisis' | string | null | undefined

const SIX_SECTIONS = [
  'section_1_warning_signs',
  'section_2_internal_coping',
  'section_3_distraction_contacts',
  'section_4_help_contacts',
  'section_5_professionals_agencies',
  'section_6_means_restriction',
] as const

export function CrisisSafetyPlanBanner({
  patientId,
  riskLevel,
}: {
  patientId: string
  riskLevel: RiskLevel
}) {
  const [hasUsablePlan, setHasUsablePlan] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    if (riskLevel !== 'high' && riskLevel !== 'crisis') {
      setHasUsablePlan(true) // not relevant, suppress banner
      return
    }
    ;(async () => {
      try {
        const res = await fetch(`/api/ehr/safety-plans?patient_id=${encodeURIComponent(patientId)}`)
        if (!res.ok) { if (!cancelled) setHasUsablePlan(false); return }
        const json = await res.json()
        const active = (json.plans || []).find((p: any) => p.status === 'active')
        if (!active) { if (!cancelled) setHasUsablePlan(false); return }
        const anyFilled = SIX_SECTIONS.some(
          (k) => typeof active[k] === 'string' && active[k].trim().length > 0,
        )
        if (!cancelled) setHasUsablePlan(anyFilled)
      } catch {
        if (!cancelled) setHasUsablePlan(false)
      }
    })()
    return () => { cancelled = true }
  }, [patientId, riskLevel])

  if (riskLevel !== 'high' && riskLevel !== 'crisis') return null
  if (hasUsablePlan === null) return null
  if (hasUsablePlan) return null

  return (
    <div className="bg-red-50 border border-red-300 rounded-lg p-4 mb-4 flex items-start gap-3">
      <ShieldAlert className="w-5 h-5 text-red-700 mt-0.5 flex-shrink-0" />
      <div className="flex-1">
        <div className="font-semibold text-red-900">
          High risk · no completed safety plan on file
        </div>
        <p className="text-sm text-red-800 mt-1">
          This patient is flagged as high risk, but the Stanley-Brown safety plan
          hasn&apos;t been completed yet. Build the plan together before the
          session ends.
        </p>
      </div>
    </div>
  )
}
