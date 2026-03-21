'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

export default function SettingsPage() {
  const [practice, setPractice] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testingNotification, setTestingNotification] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<any>(null)
  const [form, setForm] = useState({
    name: '',
    hours: '',
    location: '',
    specialties: '',
    telehealth: true,
    therapist_phone: '',
  })
  const [notifPrefs, setNotifPrefs] = useState<any>(null)
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
        setNotifPrefs(p.notification_prefs || {})
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

  const handleSaveNotificationPrefs = async () => {
    if (!practice) return
    setSaving(true)
    const res = await fetch('/api/notifications/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notifPrefs),
    })
    setSaving(false)
    if (res.ok) setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const handleTestNotification = async (type: 'slack' | 'smart_light' | 'push') => {
    setTestingNotification(type)
    setTestResult(null)
    try {
      const res = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          message: `Test notification from Harbor at ${new Date().toLocaleTimeString()}`,
        }),
      })
      const data = await res.json()
      setTestResult({ type, success: res.ok, data })
    } catch (error: any) {
      setTestResult({ type, success: false, error: error.message })
    } finally {
      setTestingNotification(null)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-32"><div className="w-5 h-5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Practice Settings</h1>
        <p className="text-gray-500 mt-1">Changes sync to Ellie automatically</p>
      </div>

      <div className="space-y-6">
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

      {/* Notification Preferences Section */}
      {notifPrefs && (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          <div className="p-5">
            <h2 className="font-semibold text-gray-700 mb-4 text-sm uppercase tracking-wide">Notification Preferences</h2>

            {/* In-Session Mode Toggle */}
            <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setNotifPrefs(p => ({ ...p, in_session_mode: !p.in_session_mode }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${notifPrefs.in_session_mode ? 'bg-teal-600' : 'bg-gray-200'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notifPrefs.in_session_mode ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <div className="flex-1">
                  <label className="font-medium text-gray-700 block">In-Session Mode</label>
                  <p className="text-xs text-gray-500 mt-0.5">When enabled, only silent notifications are sent during business hours</p>
                </div>
              </div>
              {notifPrefs.in_session_mode && (
                <div className="mt-3 ml-14">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={notifPrefs.in_session_silent_only ?? true}
                      onChange={e => setNotifPrefs(p => ({ ...p, in_session_silent_only: e.target.checked }))}
                      className="rounded border-gray-300"
                    />
                    <label className="text-xs text-gray-600">Only allow silent notifications when in session</label>
                  </div>
                </div>
              )}
            </div>

            {/* Crisis Alerts */}
            <div className="mb-6">
              <h3 className="font-medium text-gray-700 mb-3 text-sm">Crisis Alerts</h3>
              <div className="space-y-2 pl-4 border-l-2 border-red-200">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notifPrefs.crisis?.sms ?? true}
                    onChange={e => setNotifPrefs(p => ({
                      ...p,
                      crisis: { ...p.crisis, sms: e.target.checked }
                    }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">SMS Alert</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notifPrefs.crisis?.push ?? true}
                    onChange={e => setNotifPrefs(p => ({
                      ...p,
                      crisis: { ...p.crisis, push: e.target.checked }
                    }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">Push Notification</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notifPrefs.crisis?.slack ?? false}
                    onChange={e => setNotifPrefs(p => ({
                      ...p,
                      crisis: { ...p.crisis, slack: e.target.checked }
                    }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">Slack</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notifPrefs.crisis?.smart_light ?? false}
                    onChange={e => setNotifPrefs(p => ({
                      ...p,
                      crisis: { ...p.crisis, smart_light: e.target.checked }
                    }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">Smart Light</span>
                </label>
              </div>
            </div>

            {/* Patient Arrivals */}
            <div className="mb-6">
              <h3 className="font-medium text-gray-700 mb-3 text-sm">Patient Arrivals</h3>
              <div className="space-y-2 pl-4 border-l-2 border-green-200">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notifPrefs.arrival?.sms ?? true}
                    onChange={e => setNotifPrefs(p => ({
                      ...p,
                      arrival: { ...p.arrival, sms: e.target.checked }
                    }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">SMS Alert</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notifPrefs.arrival?.push ?? true}
                    onChange={e => setNotifPrefs(p => ({
                      ...p,
                      arrival: { ...p.arrival, push: e.target.checked }
                    }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">Push Notification</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notifPrefs.arrival?.slack ?? false}
                    onChange={e => setNotifPrefs(p => ({
                      ...p,
                      arrival: { ...p.arrival, slack: e.target.checked }
                    }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">Slack</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notifPrefs.arrival?.smart_light ?? false}
                    onChange={e => setNotifPrefs(p => ({
                      ...p,
                      arrival: { ...p.arrival, smart_light: e.target.checked }
                    }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">Smart Light</span>
                </label>
              </div>
            </div>

            {/* Slack Webhook */}
            {(notifPrefs.crisis?.slack || notifPrefs.arrival?.slack) && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Slack Webhook URL</label>
                <input
                  type="text"
                  value={notifPrefs.slack_webhook_url || ''}
                  onChange={e => setNotifPrefs(p => ({ ...p, slack_webhook_url: e.target.value || null }))}
                  placeholder="https://hooks.slack.com/services/..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <p className="text-xs text-gray-400 mt-1">Get this from Slack Incoming Webhooks setup</p>
              </div>
            )}

            {/* Smart Light Webhook */}
            {(notifPrefs.crisis?.smart_light || notifPrefs.arrival?.smart_light) && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Smart Light Webhook URL</label>
                <input
                  type="text"
                  value={notifPrefs.smart_light_webhook_url || ''}
                  onChange={e => setNotifPrefs(p => ({ ...p, smart_light_webhook_url: e.target.value || null }))}
                  placeholder="https://..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <p className="text-xs text-gray-400 mt-1">Supports IFTTT Webhooks, Zapier, Hue Bridge, or any HTTP endpoint</p>
              </div>
            )}

            {/* Test Notifications */}
            <div className="mt-6 pt-4 border-t border-gray-100">
              <p className="text-sm font-medium text-gray-700 mb-3">Test Notifications</p>
              <div className="flex gap-2">
                {notifPrefs.slack_webhook_url && (
                  <button
                    onClick={() => handleTestNotification('slack')}
                    disabled={testingNotification === 'slack'}
                    className="px-3 py-2 bg-slate-600 text-white text-xs font-medium rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors"
                  >
                    {testingNotification === 'slack' ? 'Testing...' : 'Test Slack'}
                  </button>
                )}
                {notifPrefs.smart_light_webhook_url && (
                  <button
                    onClick={() => handleTestNotification('smart_light')}
                    disabled={testingNotification === 'smart_light'}
                    className="px-3 py-2 bg-yellow-600 text-white text-xs font-medium rounded-lg hover:bg-yellow-700 disabled:opacity-50 transition-colors"
                  >
                    {testingNotification === 'smart_light' ? 'Testing...' : 'Test Smart Light'}
                  </button>
                )}
                {(notifPrefs.crisis?.push || notifPrefs.arrival?.push) && (
                  <button
                    onClick={() => handleTestNotification('push')}
                    disabled={testingNotification === 'push'}
                    className="px-3 py-2 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                  >
                    {testingNotification === 'push' ? 'Testing...' : 'Test Push'}
                  </button>
                )}
              </div>
              {testResult && (
                <div className={`mt-2 p-3 rounded-lg text-xs ${testResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  {testResult.success ? '✓' : '✗'} {testResult.data?.results?.[0]?.message || testResult.data?.message || testResult.error}
                </div>
              )}
            </div>
          </div>

          <div className="p-5 flex items-center justify-between">
            <p className="text-xs text-gray-400">Notification preferences update in real-time</p>
            <button
              onClick={handleSaveNotificationPrefs}
              disabled={saving}
              className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Preferences'}
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
