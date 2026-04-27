// components/ehr/StanleyBrownPlanEditor.tsx
//
// Wave 38 / TS10 — Stanley-Brown structured Safety Plan editor.
//
// Six free-text sections matching the published 6-step model, each with
// a verbatim helper prompt from the published guidance rendered as
// muted/italic placeholder text on the textarea. The placeholder is
// visually distinct from real content (gray + italic) and disappears
// the moment the therapist starts typing. The therapist fills in each
// section collaboratively with the patient.

'use client'

import { useEffect, useState } from 'react'
import { ShieldAlert, Save, Check } from 'lucide-react'

// Wave 38 / TS10 follow-up — verbatim helper prompts from the published
// Stanley-Brown 6-step model are surfaced as placeholder/helper text on
// each section's textarea. Placeholder copy is grayed out and disappears
// when the therapist starts typing real content.
const SECTIONS: Array<{ key: string; label: string; placeholder: string }> = [
  {
    key: 'section_1_warning_signs',
    label: 'Step 1 — Warning Signs',
    placeholder:
      "Examples: feeling hopeless, thinking 'I can't do this anymore', drinking alone, isolating from family, feeling rejected, anniversary of a loss.",
  },
  {
    key: 'section_2_internal_coping',
    label: 'Step 2 — Internal Coping Strategies',
    placeholder:
      'Examples: take a walk, listen to music I love, take a hot shower, exercise, watch a comforting movie, journal, do a craft, pet the dog.',
  },
  {
    key: 'section_3_distraction_contacts',
    label: 'Step 3 — People and Social Settings That Provide Distraction',
    placeholder:
      "List 1-2 people I can call or visit (not therapists) and 1-2 places I can go where I'm around other people: coffee shop, library, gym, religious community, park.",
  },
  {
    key: 'section_4_help_contacts',
    label: 'Step 4 — People I Can Ask for Help',
    placeholder:
      'Name and phone number of 2-3 people. These are people I can be honest with about my feelings, not just distractions.',
  },
  {
    key: 'section_5_professionals_agencies',
    label: 'Step 5 — Professionals and Agencies I Can Contact During a Crisis',
    placeholder:
      'My therapist (name + after-hours line). My psychiatrist if I have one. 988 Suicide & Crisis Lifeline (call or text 988). Local emergency room. 911 if I cannot keep myself safe.',
  },
  {
    key: 'section_6_means_restriction',
    label: 'Step 6 — Making the Environment Safer',
    placeholder:
      'Means restriction. Remove or secure firearms (give to a trusted person, lock in a gun safe, hand to local police for storage). Secure medications (lock box, give to family member). Remove sharp objects from immediate access. Plan for what happens if I have urges — who removes the means and how fast.',
  },
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
      <div className="space-y-4">
        {SECTIONS.map((s) => (
          // Each section is its own block, ≥44px tap target on mobile.
          <div key={s.key} className="min-h-[44px]">
            <label
              htmlFor={`sb-${s.key}`}
              className="block text-sm font-medium text-gray-900 mb-1"
            >
              {s.label}
            </label>
            <textarea
              id={`sb-${s.key}`}
              rows={3}
              value={draft[s.key] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
              // Muted gray placeholder so the prompt is visually distinct
              // from real content. Disappears as soon as the user types.
              placeholder={s.placeholder}
              className="w-full min-h-[88px] border border-gray-200 rounded-lg px-3 py-2 text-sm placeholder:text-gray-400 placeholder:italic focus:ring-2 focus:ring-red-500 focus:border-transparent"
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
