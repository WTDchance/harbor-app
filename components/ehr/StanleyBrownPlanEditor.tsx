// components/ehr/StanleyBrownPlanEditor.tsx
//
// Wave 38 / TS10 — Stanley-Brown structured Safety Plan scaffold.
//
// Six free-text sections matching the published 6-step model. No helper
// or hint text is rendered inside the sections — the therapist fills
// these in collaboratively with the patient. Placeholder is empty for
// every textarea by design (helper/prompt text deferred to a focused
// follow-up task where the published guidance will be supplied verbatim).

'use client'

import { useEffect, useState } from 'react'
import { ShieldAlert, Save, Check } from 'lucide-react'

const SECTIONS: Array<{ key: string; label: string }> = [
  { key: 'section_1_warning_signs',          label: '1. Warning Signs' },
  { key: 'section_2_internal_coping',        label: '2. Internal Coping Strategies' },
  { key: 'section_3_distraction_contacts',   label: '3. Social Contacts and Settings That Provide Distraction' },
  { key: 'section_4_help_contacts',          label: '4. People I Can Ask for Help' },
  { key: 'section_5_professionals_agencies', label: '5. Professionals and Agencies I Can Contact' },
  { key: 'section_6_means_restriction',      label: '6. Making the Environment Safer' },
]

type Plan = Record<string, any> & {
  id?: string
  status?: 'draft' | 'active' | 'revised' | 'archived'
}

export function StanleyBrownPlanEditor({ patientId }: { patientId: string }) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/ehr/safety-plans?patient_id=${encodeURIComponent(patientId)}`)
        if (!res.ok) { if (!cancelled) setPlan(null); return }
        const json = await res.json()
        const active = (json.plans || []).find((p: any) => p.status === 'active') ?? json.plans?.[0] ?? null
        if (cancelled) return
        setPlan(active)
        const seed: Record<string, string> = {}
        for (const s of SECTIONS) seed[s.key] = active?.[s.key] ?? ''
        setDraft(seed)
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [patientId])

  async function save() {
    setSaving(true); setErr(null)
    try {
      // If no active plan exists, POST creates one. Otherwise PATCH the active.
      if (!plan) {
        const res = await fetch('/api/ehr/safety-plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patient_id: patientId, status: 'active', ...draft }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Save failed')
        setPlan(json.plan)
      } else {
        const res = await fetch(`/api/ehr/safety-plans/${plan.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Save failed')
        setPlan(json.plan)
      }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  if (loading) return null
  const filledCount = SECTIONS.filter((s) => (draft[s.key] ?? '').trim().length > 0).length

  return (
    <div className="bg-white border border-red-200 rounded-lg p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-red-600" />
          Stanley-Brown Safety Plan
          <span className="text-xs font-normal bg-gray-50 text-gray-600 border border-gray-200 rounded-full px-2 py-0.5">
            {filledCount}/{SECTIONS.length} sections complete
          </span>
        </h2>
      </div>
      <div className="space-y-3">
        {SECTIONS.map((s) => (
          <div key={s.key}>
            <label className="block text-sm font-medium text-gray-900 mb-1">{s.label}</label>
            <textarea
              rows={3}
              value={draft[s.key] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
              placeholder=""
            />
          </div>
        ))}
        {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-60"
          >
            {plan ? <Save className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            {plan ? 'Save changes' : 'Create safety plan'}
          </button>
        </div>
      </div>
    </div>
  )
}
