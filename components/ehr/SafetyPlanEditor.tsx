// components/ehr/SafetyPlanEditor.tsx
// Interactive Stanley-Brown safety plan editor. Six sections, each a list
// of free-text items. Last two lists (support_contacts + professional_contacts)
// are richer — name + phone + relationship.

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, CheckCircle2 } from 'lucide-react'

type Contact = { name: string; phone: string; relationship?: string }
type Plan = {
  id: string
  warning_signs: string[]
  internal_coping: string[]
  distraction_people_places: string[]
  support_contacts: Contact[]
  professional_contacts: Contact[]
  means_restriction: string | null
  reasons_for_living: string[]
  status: string
}

export function SafetyPlanEditor({ initial }: { initial: any }) {
  const router = useRouter()
  const [plan, setPlan] = useState<Plan>({
    id: initial.id,
    warning_signs: initial.warning_signs || [],
    internal_coping: initial.internal_coping || [],
    distraction_people_places: initial.distraction_people_places || [],
    support_contacts: initial.support_contacts || [],
    professional_contacts: initial.professional_contacts || [],
    means_restriction: initial.means_restriction ?? null,
    reasons_for_living: initial.reasons_for_living || [],
    status: initial.status,
  })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isLocked = plan.status === 'archived'

  async function save(nextStatus?: 'active') {
    setSaving(true); setError(null)
    try {
      const payload: any = {
        warning_signs: plan.warning_signs,
        internal_coping: plan.internal_coping,
        distraction_people_places: plan.distraction_people_places,
        support_contacts: plan.support_contacts,
        professional_contacts: plan.professional_contacts,
        means_restriction: plan.means_restriction,
        reasons_for_living: plan.reasons_for_living,
      }
      if (nextStatus) payload.status = nextStatus
      const res = await fetch(`/api/ehr/safety-plans/${plan.id}`, {
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
      <StringList
        label="1. Warning signs"
        hint="Thoughts, moods, situations, and behaviors that signal an approaching crisis"
        value={plan.warning_signs}
        onChange={(v) => setPlan((p) => ({ ...p, warning_signs: v }))}
        disabled={isLocked}
      />
      <StringList
        label="2. Internal coping strategies"
        hint="Things the patient can do alone to distract from suicidal thoughts"
        value={plan.internal_coping}
        onChange={(v) => setPlan((p) => ({ ...p, internal_coping: v }))}
        disabled={isLocked}
      />
      <StringList
        label="3. People and social settings that provide distraction"
        hint="Friends, places (not therapy settings) that shift attention"
        value={plan.distraction_people_places}
        onChange={(v) => setPlan((p) => ({ ...p, distraction_people_places: v }))}
        disabled={isLocked}
      />
      <ContactList
        label="4. People I can ask for help"
        hint="Friends, family — people the patient trusts"
        value={plan.support_contacts}
        onChange={(v) => setPlan((p) => ({ ...p, support_contacts: v }))}
        disabled={isLocked}
      />
      <ContactList
        label="5. Professionals and agencies to contact during a crisis"
        hint="Therapist, psychiatrist, PCP, local crisis line, ER"
        value={plan.professional_contacts}
        onChange={(v) => setPlan((p) => ({ ...p, professional_contacts: v }))}
        disabled={isLocked}
      />
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">6. Means restriction</label>
        <p className="text-xs text-gray-500 mb-2">How the patient will make their environment safer — restricting access to lethal means.</p>
        <textarea
          disabled={isLocked}
          value={plan.means_restriction ?? ''}
          onChange={(e) => setPlan((p) => ({ ...p, means_restriction: e.target.value }))}
          rows={3}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
        />
      </div>
      <StringList
        label="Reasons for living"
        hint="What the patient wants to live for — family, goals, values, hopes"
        value={plan.reasons_for_living}
        onChange={(v) => setPlan((p) => ({ ...p, reasons_for_living: v }))}
        disabled={isLocked}
      />

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
        <strong>24/7 crisis resources:</strong> 988 Suicide &amp; Crisis Lifeline (call or text). Local ER if imminent danger.
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
          {saving ? 'Saving…' : 'Save'}
        </button>
        {plan.status !== 'active' && !isLocked && (
          <button
            type="button"
            onClick={() => save('active')}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            {saving ? 'Activating…' : 'Activate safety plan'}
          </button>
        )}
      </div>
    </div>
  )
}

function StringList({ label, hint, value, onChange, disabled }: {
  label: string; hint?: string; value: string[]; onChange: (v: string[]) => void; disabled?: boolean
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-500 mb-2">{hint}</p>}
      <div className="space-y-1.5">
        {value.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              disabled={disabled}
              value={item}
              onChange={(e) => {
                const next = value.slice()
                next[i] = e.target.value
                onChange(next)
              }}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
            />
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="p-1.5 text-gray-400 hover:text-red-600"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange([...value, ''])}
            className="inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-900 font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        )}
      </div>
    </div>
  )
}

function ContactList({ label, hint, value, onChange, disabled }: {
  label: string; hint?: string; value: Contact[]; onChange: (v: Contact[]) => void; disabled?: boolean
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-500 mb-2">{hint}</p>}
      <div className="space-y-2">
        {value.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
            <input
              disabled={disabled}
              value={c.name}
              onChange={(e) => {
                const next = value.slice(); next[i] = { ...c, name: e.target.value }; onChange(next)
              }}
              placeholder="Name"
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
            />
            <input
              disabled={disabled}
              value={c.phone}
              onChange={(e) => {
                const next = value.slice(); next[i] = { ...c, phone: e.target.value }; onChange(next)
              }}
              placeholder="Phone"
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
            />
            <input
              disabled={disabled}
              value={c.relationship ?? ''}
              onChange={(e) => {
                const next = value.slice(); next[i] = { ...c, relationship: e.target.value }; onChange(next)
              }}
              placeholder="Relationship / role"
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
            />
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="p-1.5 text-gray-400 hover:text-red-600"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange([...value, { name: '', phone: '', relationship: '' }])}
            className="inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-900 font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> Add contact
          </button>
        )}
      </div>
    </div>
  )
}
