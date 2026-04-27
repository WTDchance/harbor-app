'use client'

// Wave 41 / T6 — sliding-fee scale configuration.
//
// Practice owner / admin configures whether sliding fee is on and the
// list of tiers. When ON, the charges POST route (Wave 38+ AWS port)
// applies the matching tier's fee_pct to the base CPT fee.
//
// Patient assignment lives on the patient edit page (W40 P4) via the
// existing `fee_tier` text field — patients pick a tier name that
// matches one defined here.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, AlertCircle, Info } from 'lucide-react'

interface Tier {
  name: string
  fee_pct: number
  income_threshold_cents?: number | null
}

export default function SlidingFeePage() {
  const [enabled, setEnabled] = useState(false)
  const [tiers, setTiers] = useState<Tier[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ehr/practice/sliding-fee', { credentials: 'include' })
      if (!res.ok) {
        setError(`Could not load config (${res.status})`)
        return
      }
      const data = await res.json()
      setEnabled(!!data.enabled)
      setTiers(Array.isArray(data.config) ? data.config : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  function addTier() {
    setTiers((cur) => [...cur, { name: '', fee_pct: 100, income_threshold_cents: null }])
  }

  function updateTier(idx: number, patch: Partial<Tier>) {
    setTiers((cur) => cur.map((t, i) => i === idx ? { ...t, ...patch } : t))
  }

  function removeTier(idx: number) {
    setTiers((cur) => cur.filter((_, i) => i !== idx))
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/ehr/practice/sliding-fee', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, config: tiers }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error?.message || `Save failed (${res.status})`)
        return
      }
      setSavedAt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
    } catch (err: any) {
      setError(err?.message || 'Network error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </main>
    )
  }

  return (
    <main className="flex-1 max-w-3xl mx-auto w-full pb-32 p-6">
      <Link
        href="/dashboard/settings"
        className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-800"
        style={{ minHeight: 44 }}
      >
        <ArrowLeft className="w-4 h-4" />
        Back to settings
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 mt-3">Sliding fee scale</h1>
      <p className="text-sm text-gray-500 mt-1">
        Discount your CPT base fee per a patient's assigned tier. Common in
        community / training programs.
      </p>

      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4 mt-4">
        <label className="flex items-start gap-3 cursor-pointer" style={{ minHeight: 44 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-1 rounded text-teal-600"
          />
          <div>
            <div className="text-sm font-semibold text-gray-900">Enable sliding fee</div>
            <p className="text-xs text-gray-500 mt-0.5">
              When on, charges generated for patients with an assigned tier are
              discounted per the table below. When off, every charge bills at
              full CPT base fee regardless of patient assignment.
            </p>
          </div>
        </label>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 mt-4 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Tiers</h2>
          <button
            onClick={addTier}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-md hover:bg-teal-700"
            style={{ minHeight: 36 }}
          >
            <Plus className="w-3.5 h-3.5" />
            Add tier
          </button>
        </div>

        {tiers.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">
            No tiers configured. Add at least one tier and assign patients via the patient profile.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {tiers.map((t, i) => (
              <div key={i} className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                  <input
                    value={t.name}
                    onChange={(e) => updateTier(i, { name: e.target.value })}
                    placeholder="e.g. Tier A — Reduced"
                    className="w-full p-2 text-sm border border-gray-200 rounded-lg"
                    style={{ minHeight: 44 }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Fee % of base</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={t.fee_pct}
                    onChange={(e) => updateTier(i, { fee_pct: Number(e.target.value) })}
                    className="w-full p-2 text-sm border border-gray-200 rounded-lg"
                    style={{ minHeight: 44 }}
                  />
                  <p className="text-xs text-gray-500 mt-0.5">50 = patient pays half</p>
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Income threshold (cents, optional)</label>
                    <input
                      type="number"
                      min="0"
                      value={t.income_threshold_cents ?? ''}
                      onChange={(e) => updateTier(i, { income_threshold_cents: e.target.value === '' ? null : Number(e.target.value) })}
                      className="w-full p-2 text-sm border border-gray-200 rounded-lg"
                      style={{ minHeight: 44 }}
                    />
                  </div>
                  <button
                    onClick={() => removeTier(i)}
                    className="px-2.5 py-2 text-red-700 hover:bg-red-50 rounded-md"
                    title="Remove tier"
                    style={{ minHeight: 44, minWidth: 44 }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-start gap-2">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          Tier names must match exactly between this config and a patient's
          assigned <code>fee_tier</code>. A misconfigured tier silently falls
          back to full fee (it never raises a patient's fee).
        </div>
      </div>

      <div
        className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-3 z-30"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 12px)' }}
      >
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-2 px-1">
          <span className="text-xs text-gray-500">{savedAt ? `Saved at ${savedAt}` : ''}</span>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-60"
            style={{ minHeight: 44 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </main>
  )
}
