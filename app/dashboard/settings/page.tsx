'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

const TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
]

export default function SettingsPage() {
  const [practice, setPractice] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    ai_name: '',
    phone_number: '',
    timezone: 'America/Los_Angeles',
    insurance_accepted: '',
    notification_emails: '',
  })

  const supabase = createClient()

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: userRecord } = await supabase
        .from('users')
        .select('practice_id')
        .eq('email', user.email)
        .single()

      if (!userRecord?.practice_id) {
        setError('No practice found for this account. Please complete onboarding.')
        setLoading(false)
        return
      }

      const { data: p } = await supabase
        .from('practices')
        .select('*')
        .eq('id', userRecord.practice_id)
        .single()

      if (p) {
        setPractice(p)
        setForm({
          name: p.name || '',
          ai_name: p.ai_name || '',
          phone_number: p.phone_number || '',
          timezone: p.timezone || 'America/Los_Angeles',
          insurance_accepted: (p.insurance_accepted || []).join(', '),
          notification_emails: (p.notification_emails || []).join(', '),
        })
      }
      setLoading(false)
    }
    load()
  }, [supabase])

  const handleSave = async () => {
    if (!practice) return
    setSaving(true)
    setError(null)

    const res = await fetch(`/api/practices/${practice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        ai_name: form.ai_name,
        phone_number: form.phone_number,
        timezone: form.timezone,
        insurance_accepted: form.insurance_accepted.split(',').map((s: string) => s.trim()).filter(Boolean),
        notification_emails: form.notification_emails.split(',').map((s: string) => s.trim()).filter(Boolean),
      }),
    })

    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } else {
      setError('Failed to save. Please try again.')
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-32">
      <div className="w-5 h-5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error && !practice) return (
    <div className="max-w-2xl">
      <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-red-700 text-sm">{error}</div>
    </div>
  )

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Practice Settings</h1>
        <p className="text-gray-500 mt-1">Changes sync to {practice?.ai_name || 'your AI receptionist'} automatically</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Practice Info</h2>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Practice Name</label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">AI Receptionist Name</label>
            <input type="text" value={form.ai_name} onChange={e => setForm(f => ({ ...f, ai_name: e.target.value }))} placeholder="e.g. Ellie" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <p className="text-xs text-gray-400 mt-1">The name callers will know your receptionist as</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Practice Phone Number</label>
            <input type="tel" value={form.phone_number} onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))} placeholder="+15415394890" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <p className="text-xs text-gray-400 mt-1">The Twilio number patients call (format: +15415394890)</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
            <select value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
              {TIMEZONES.map(tz => (<option key={tz} value={tz}>{tz}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Insurance Accepted</label>
            <input type="text" value={form.insurance_accepted} onChange={e => setForm(f => ({ ...f, insurance_accepted: e.target.value }))} placeholder="Aetna, Blue Cross, Cigna, United, Private Pay" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <p className="text-xs text-gray-400 mt-1">Comma-separated — Ellie will mention these to callers who ask</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Call Summary Notification Emails</label>
            <input type="text" value={form.notification_emails} onChange={e => setForm(f => ({ ...f, notification_emails: e.target.value }))} placeholder="therapist@email.com, owner@email.com, admin@email.com" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <p className="text-xs text-gray-400 mt-1">Comma-separated — everyone listed gets an email after each call with a transcript and summary</p>
          </div>
        </div>

        <div className="p-5 border-t border-gray-100 flex items-center justify-between">
          <div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            {!error && <p className="text-xs text-gray-400">Saving updates your receptionist's knowledge in real time</p>}
          </div>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors">
            {saving ? 'Saving...' : saved ? '\u2713 Saved' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
