// app/dashboard/ehr/preferences/page.tsx
// Practice admin picks the shape of the product. Starts with a preset
// (Solo minimal / Solo standard / Small / Large etc.), then optionally
// fine-tunes individual feature toggles.

'use client'

import { useEffect, useState } from 'react'
import { Sliders, Check, LayoutDashboard } from 'lucide-react'
import { PRESETS, type UiPreferences, type PracticeScale, type MetricsDepth, type FeatureFlags } from '@/lib/ehr/preferences'

const FEATURE_LABELS: Record<keyof FeatureFlags, string> = {
  assessments: 'Assessments (PHQ-9, GAD-7, mood, etc.)',
  treatment_plans: 'Treatment plans',
  safety_plans: 'Safety plans (Stanley-Brown)',
  mood_logs: 'Between-session mood check-ins',
  homework: 'Homework assignments',
  ai_draft: 'AI-drafted progress notes (Claude)',
  voice_dictation: 'Voice dictation',
  telehealth: 'Telehealth video sessions',
  portal: 'Patient portal',
  mandatory_reports: 'Mandatory reporting log',
  supervision: 'Supervision & co-signing',
  reports: 'Practice productivity reports',
  audit_log: 'EHR audit log',
  billing: 'Billing & claims',
}

const FEATURE_GROUPS: Array<{ title: string; keys: Array<keyof FeatureFlags> }> = [
  { title: 'Clinical', keys: ['assessments', 'treatment_plans', 'safety_plans', 'mood_logs', 'homework', 'ai_draft', 'voice_dictation'] },
  { title: 'Operations', keys: ['telehealth', 'portal', 'mandatory_reports', 'supervision', 'billing'] },
  { title: 'Admin & analytics', keys: ['reports', 'audit_log'] },
]

export default function PreferencesPage() {
  const [prefs, setPrefs] = useState<UiPreferences | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const res = await fetch('/api/ehr/preferences')
    const json = await res.json()
    if (res.ok) setPrefs(json.preferences)
    else setError(json.error || 'Failed to load')
  }
  useEffect(() => { load() }, [])

  async function applyPreset(scale: PracticeScale, metrics_depth: MetricsDepth) {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/ehr/preferences', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply_preset: true, scale, metrics_depth }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      setPrefs(json.preferences)
      setToast('Preset applied. Reload pages to see the new sidebar.')
      setTimeout(() => setToast(null), 3000)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed') }
    finally { setSaving(false) }
  }

  async function toggleFeature(key: keyof FeatureFlags, value: boolean) {
    if (!prefs) return
    const next = { ...prefs, features: { ...prefs.features, [key]: value } }
    setPrefs(next) // optimistic
    try {
      const res = await fetch('/api/ehr/preferences', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features: { [key]: value } }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      setPrefs(json.preferences)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
      // revert
      setPrefs(prefs)
    }
  }

  async function toggleSidebar(key: 'compact' | 'show_analytics' | 'show_billing', value: boolean) {
    if (!prefs) return
    const next = { ...prefs, sidebar: { ...prefs.sidebar, [key]: value } }
    setPrefs(next)
    try {
      const res = await fetch('/api/ehr/preferences', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sidebar: { [key]: value } }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      setPrefs(json.preferences)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); setPrefs(prefs) }
  }

  if (!prefs) return <div className="max-w-4xl mx-auto py-8 px-4 text-sm text-gray-500">Loading…</div>

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <Sliders className="w-6 h-6 text-teal-600" />
          Practice preferences
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Shape Harbor for how your practice actually works. Pick a preset to start, then fine-tune.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">{error}</div>}
      {toast && <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">{toast}</div>}

      {/* Presets */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
          <LayoutDashboard className="w-4 h-4 text-gray-500" />
          Pick a preset
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {PRESETS.map((p) => {
            const active = prefs.scale === p.scale && prefs.metrics_depth === p.metrics_depth
            return (
              <button
                key={p.label}
                onClick={() => applyPreset(p.scale, p.metrics_depth)}
                disabled={saving}
                className={`text-left p-4 rounded-lg border transition disabled:opacity-50 ${
                  active
                    ? 'border-teal-600 bg-teal-50 ring-2 ring-teal-600/20'
                    : 'border-gray-200 bg-white hover:border-teal-500 hover:bg-teal-50'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-gray-900 text-sm">{p.label}</span>
                  {active && <Check className="w-4 h-4 text-teal-700" />}
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">{p.description}</p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Feature toggles */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-semibold text-gray-900 mb-3">Fine-tune features</h2>
        <p className="text-xs text-gray-500 mb-4">
          Turn off anything you don&apos;t use. Toggled-off features disappear from the sidebar, the patient profile,
          and the portal.
        </p>
        <div className="space-y-5">
          {FEATURE_GROUPS.map((g) => (
            <div key={g.title}>
              <div className="text-xs uppercase tracking-wider text-gray-500 font-medium mb-2">{g.title}</div>
              <div className="space-y-2">
                {g.keys.map((k) => (
                  <label
                    key={k}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                  >
                    <span className="text-sm text-gray-800">{FEATURE_LABELS[k]}</span>
                    <Toggle checked={prefs.features[k]} onChange={(v) => toggleFeature(k, v)} />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sidebar */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-semibold text-gray-900 mb-3">Sidebar</h2>
        <div className="space-y-2">
          <label className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
            <div>
              <div className="text-sm text-gray-800">Compact sidebar</div>
              <div className="text-xs text-gray-500">Tighter spacing for cleaner look.</div>
            </div>
            <Toggle checked={prefs.sidebar.compact} onChange={(v) => toggleSidebar('compact', v)} />
          </label>
          <label className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
            <div>
              <div className="text-sm text-gray-800">Show analytics group</div>
              <div className="text-xs text-gray-500">Practice Reports, Audit Log, Analytics.</div>
            </div>
            <Toggle checked={prefs.sidebar.show_analytics} onChange={(v) => toggleSidebar('show_analytics', v)} />
          </label>
          <label className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
            <div>
              <div className="text-sm text-gray-800">Show billing surfaces</div>
              <div className="text-xs text-gray-500">Billing page, patient invoicing, superbills.</div>
            </div>
            <Toggle checked={prefs.sidebar.show_billing} onChange={(v) => toggleSidebar('show_billing', v)} />
          </label>
        </div>
      </div>

      <div className="text-xs text-gray-500">
        Current: <strong>{prefs.scale}</strong> · <strong>{prefs.metrics_depth}</strong>.
        Changes take effect immediately — reload any open page to see the new sidebar.
      </div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
        checked ? 'bg-teal-600' : 'bg-gray-300'
      }`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
        checked ? 'translate-x-5' : 'translate-x-1'
      }`} />
    </button>
  )
}
