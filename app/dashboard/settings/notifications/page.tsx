// app/dashboard/settings/notifications/page.tsx
//
// Wave 50 — notification preferences page. Surfaces both the existing
// practice-level email/push toggles AND the new per-user SMS toggles
// (sms_appointment_reminders_enabled, sms_cancellation_fill_enabled,
// sms_two_factor_enabled).
//
// Component style mirrors the existing email-toggle blocks elsewhere in
// dashboard/settings: a labelled checkbox + helper text + Save button.
// The page POSTs to /api/notifications/preferences which now handles
// both pref scopes in one shot.

'use client'

import { useEffect, useState } from 'react'

interface Preferences {
  // practice-level
  email_calls: boolean
  email_intakes: boolean
  email_reminders: boolean
  push_calls: boolean
  push_intakes: boolean
  push_reminders: boolean
  // user-level (SMS — Wave 50)
  sms_appointment_reminders_enabled: boolean
  sms_cancellation_fill_enabled: boolean
  sms_two_factor_enabled: boolean
}

const DEFAULTS: Preferences = {
  email_calls: true,
  email_intakes: true,
  email_reminders: false,
  push_calls: true,
  push_intakes: false,
  push_reminders: false,
  sms_appointment_reminders_enabled: true,
  sms_cancellation_fill_enabled: true,
  sms_two_factor_enabled: true,
}

export default function NotificationSettingsPage() {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/notifications/preferences')
        const json = await res.json()
        if (!cancelled && json?.preferences) {
          setPrefs({ ...DEFAULTS, ...json.preferences })
        }
      } catch {
        /* ignore — show defaults */
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  function toggle(key: keyof Preferences) {
    setPrefs(p => ({ ...p, [key]: !p[key] }))
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(prefs),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      setSavedAt(Date.now())
    } catch (err: any) {
      setError(err?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-gray-500">Loading…</div>
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="text-sm text-gray-500 mt-1">
          Control how Harbor reaches you and your patients.
        </p>
      </header>

      {/* Email — practice-level (unchanged from earlier waves) */}
      <section className="space-y-3">
        <h2 className="font-medium">Email</h2>
        <Toggle
          label="Crisis & call alerts"
          checked={prefs.email_calls}
          onChange={() => toggle('email_calls')}
        />
        <Toggle
          label="Intake completion alerts"
          checked={prefs.email_intakes}
          onChange={() => toggle('email_intakes')}
        />
        <Toggle
          label="Reminder digests"
          checked={prefs.email_reminders}
          onChange={() => toggle('email_reminders')}
        />
      </section>

      {/* SMS — user-level, Wave 50 */}
      <section className="space-y-3">
        <h2 className="font-medium">SMS to patients</h2>
        <p className="text-xs text-gray-500">
          Patients will receive automated text messages. Every message
          includes "Reply STOP to opt out".
        </p>
        <Toggle
          label="Appointment reminders (24h, 2h, 30 min before)"
          checked={prefs.sms_appointment_reminders_enabled}
          onChange={() => toggle('sms_appointment_reminders_enabled')}
        />
        <Toggle
          label="Cancellation-fill offers"
          checked={prefs.sms_cancellation_fill_enabled}
          onChange={() => toggle('sms_cancellation_fill_enabled')}
        />
        <Toggle
          label="Two-factor login codes (sent to staff)"
          checked={prefs.sms_two_factor_enabled}
          onChange={() => toggle('sms_two_factor_enabled')}
        />
      </section>

      {/* Push — practice-level */}
      <section className="space-y-3">
        <h2 className="font-medium">Push notifications</h2>
        <Toggle
          label="Calls"
          checked={prefs.push_calls}
          onChange={() => toggle('push_calls')}
        />
        <Toggle
          label="Intakes"
          checked={prefs.push_intakes}
          onChange={() => toggle('push_intakes')}
        />
        <Toggle
          label="Reminders"
          checked={prefs.push_reminders}
          onChange={() => toggle('push_reminders')}
        />
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
        {savedAt && !error && (
          <span className="text-sm text-green-600">Saved.</span>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />
      <span>{label}</span>
    </label>
  )
}
