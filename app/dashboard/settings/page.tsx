'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

export default function SettingsPage() {
  const [practice, setPractice] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({
    name: '',
    hours: '',
    location: '',
    specialties: '',
    telehealth: true,
    therapist_phone: '',
  })
  const supabase = createClient()

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: p } = await supabase
        .from('practices')
        .select('*')
        .eq('notification_email', user.email)
        .single()
      if (p) {
        setPractice(p)
        setForm({
          name: p.name || '',
          hours: p.hours || '',
          location: p.location || '',
          specialties: (p.specialties || []).join(', '),
          telehealth: p.telehealth ?? true,
          therapist_phone: p.therapist_phone || '',
        })
      }
      setLoading(false)
    }
    load()
  }, [supabase])

  const handleSave = async () => {
    if (!practice) return
    setSaving(true)
    const res = await fetch(`/api/practices/${practice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        specialties: form.specialties.split(',').map(s => s.trim()).filter(Boolean),
      }),
    })
    setSaving(false)
    if (res.ok) setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading) return <div className="flex items-center justify-center h-32"><div className="w-5 h-5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Practice Settings</h1>
        <p className="text-gray-500 mt-1">Changes sync to Ellie automatically</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {/* Read-only info */}
        <div className="p-5">
          <h2 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">AI Assistant</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">AI Name</label>
              <p className="text-sm font-medium text-gray-700">{practice?.ai_name || 'Ellie'}</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Vapi Assistant ID</label>
              <p className="text-sm font-mono text-gray-500 truncate">{practice?.vapi_assistant_id || '—'}</p>
            </div>
          </div>
        </div>

        {/* Editable fields */}
        <div className="p-5 space-y-4">
          <h2 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">Practice Info</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Practice Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Office Hours</label>
            <input
              type="text"
              value={form.hours}
              onChange={e => setForm(f => ({ ...f, hours: e.target.value }))}
              placeholder="e.g. Monday–Friday 9am–5pm"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <input
              type="text"
              value={form.location}
              onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              placeholder="City, State or full address"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Specialties</label>
            <input
              type="text"
              value={form.specialties}
              onChange={e => setForm(f => ({ ...f, specialties: e.target.value }))}
              placeholder="anxiety, depression, trauma, couples"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p className="text-xs text-gray-400 mt-1">Comma-separated</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Therapist Cell (for crisis alerts)</label>
            <input
              type="tel"
              value={form.therapist_phone}
              onChange={e => setForm(f => ({ ...f, therapist_phone: e.target.value }))}
              placeholder="+1 (555) 000-0000"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p className="text-xs text-gray-400 mt-1">Used for urgent crisis SMS alerts only</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setForm(f => ({ ...f, telehealth: !f.telehealth }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.telehealth ? 'bg-teal-600' : 'bg-gray-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.telehealth ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <label className="text-sm font-medium text-gray-700">Telehealth sessions available</label>
          </div>
        </div>

        <div className="p-5 flex items-center justify-between">
          <p className="text-xs text-gray-400">Saving will automatically update Ellie's knowledge</p>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
