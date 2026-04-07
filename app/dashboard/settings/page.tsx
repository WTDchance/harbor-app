'use client'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
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

type GCalStatus = { connected: boolean; email: string | null } | null

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

  // Google Calendar state
  const [gcal, setGcal] = useState<GCalStatus>(null)
  const [gcalLoading, setGcalLoading] = useState(true)
  const [gcalDisconnecting, setGcalDisconnecting] = useState(false)
  const [gcalToast, setGcalToast] = useState<string | null>(null)

  // Calendar Subscription state
  const [calToken, setCalToken] = useState<string | null>(null)
  const [calFeedUrl, setCalFeedUrl] = useState<string | null>(null)
  const [calLoading, setCalLoading] = useState(true)
  const [calGenerating, setCalGenerating] = useState(false)
  const [calCopied, setCalCopied] = useState(false)

  const searchParams = useSearchParams()
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

  // Load Google Calendar connection status
  useEffect(() => {
    const loadGcal = async () => {
      setGcalLoading(true)
      try {
        const res = await fetch('/api/integrations/google-calendar')
        if (res.ok) {
          const data = await res.json()
          setGcal(data)
        }
      } catch {}
      setGcalLoading(false)
    }
    loadGcal()
  }, [])

  // Load calendar subscription token
  useEffect(() => {
    fetch('/api/calendar/token').then(r => r.json()).then(data => {
      setCalToken(data.token)
      setCalFeedUrl(data.feedUrl)
      setCalLoading(false)
    })
  }, [])

  // Handle ?gcal= param from OAuth callback
  useEffect(() => {
    const gcalParam = searchParams.get('gcal')
    if (gcalParam === 'connected') {
      setGcalToast('\u2713 Google Calendar connected!')
      setGcalLoading(true)
      fetch('/api/integrations/google-calendar')
        .then(r => r.json())
        .then(data => { setGcal(data); setGcalLoading(false) })
        .catch(() => setGcalLoading(false))
    } else if (gcalParam === 'error') {
      setGcalToast('Failed to connect Google Calendar. Please try again.')
    } else if (gcalParam === 'denied') {
      setGcalToast('Google Calendar access was denied.')
    }
    if (gcalParam) setTimeout(() => setGcalToast(null), 5000)
  }, [searchParams])

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

  const disconnectGcal = async () => {
    setGcalDisconnecting(true)
    try {
      const res = await fetch('/api/integrations/google-calendar', { method: 'DELETE' })
      if (res.ok) {
        setGcal({ connected: false, email: null })
        setGcalToast('Google Calendar disconnected.')
        setTimeout(() => setGcalToast(null), 4000)
      }
    } catch {}
    setGcalDisconnecting(false)
  }

  const generateCalToken = async () => {
    setCalGenerating(true)
    const res = await fetch('/api/calendar/token', { method: 'POST' })
    const data = await res.json()
    setCalToken(data.token)
    setCalFeedUrl(data.feedUrl)
    setCalGenerating(false)
  }

  const regenerateCalToken = async () => {
    if (!confirm('This will break your existing calendar subscription. Continue?')) return
    setCalGenerating(true)
    const res = await fetch('/api/calendar/token', { method: 'DELETE' })
    const data = await res.json()
    setCalToken(data.token)
    setCalFeedUrl(data.feedUrl)
    setCalGenerating(false)
  }

  const copyCalUrl = () => {
    if (calFeedUrl) {
      navigator.clipboard.writeText(calFeedUrl)
      setCalCopied(true)
      setTimeout(() => setCalCopied(false), 2000)
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
      {gcalToast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg animate-fade-in">
          {gcalToast}
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Practice Settings</h1>
        <p className="text-gray-500 mt-1">Changes sync to {practice?.ai_name || 'your AI receptionist'} automatically</p>
      </div>

      {/* Practice Info */}
      <div className="bg-white rounded-xl border border-gray-200 mb-6">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Practice Info</h2>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Practice Name</label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">AI Receptionist Name</label>
            <input type="text" value={form.ai_name} onChange={e => setForm(f => ({ ...f, ai_name: e.target.value }))}
              placeholder="e.g. Ellie" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <p className="text-xs text-gray-400 mt-1">The name callers will know your receptionist as</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Practice Phone Number</label>
            <input type="tel" value={form.phone_number} onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))}
              placeholder="+15415394890" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <p className="text-xs text-gray-400 mt-1">The Twilio number patients call (format: +15415394890)</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
            <select value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
              {TIMEZONES.map(tz => (<option key={tz} value={tz}>{tz}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Insurance Accepted</label>
            <input type="text" value={form.insurance_accepted} onChange={e => setForm(f => ({ ...f, insurance_accepted: e.target.value }))}
              placeholder="Aetna, Blue Cross, Cigna, United, Private Pay"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <p className="text-xs text-gray-400 mt-1">Comma-separated — your AI receptionist will mention these to callers who ask</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Call Summary Notification Emails</label>
            <input type="text" value={form.notification_emails} onChange={e => setForm(f => ({ ...f, notification_emails: e.target.value }))}
              placeholder="therapist@email.com, owner@email.com, admin@email.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <p className="text-xs text-gray-400 mt-1">Comma-separated — everyone listed gets an email after each call</p>
          </div>
        </div>
        <div className="p-5 border-t border-gray-100 flex items-center justify-between">
          <div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            {!error && <p className="text-xs text-gray-400">Saving updates your receptionist's knowledge in real time</p>}
          </div>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors">
            {saving ? 'Saving...' : saved ? '\u2713 Saved' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Calendar Subscription */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Calendar Subscription</h2>
        <p className="text-sm text-gray-500 mb-4">
          Subscribe to your appointments in Apple Calendar, Google Calendar, or Outlook.
        </p>
        {calLoading ? (
          <div className="text-sm text-gray-400">Loading...</div>
        ) : !calToken ? (
          <button onClick={generateCalToken} disabled={calGenerating}
            className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors">
            {calGenerating ? 'Generating...' : 'Generate Calendar Link'}
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input type="text" readOnly value={calFeedUrl || ''}
                className="flex-1 text-xs font-mono bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none" />
              <button onClick={copyCalUrl}
                className="px-3 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors whitespace-nowrap">
                {calCopied ? '\u2713 Copied!' : 'Copy Link'}
              </button>
            </div>
            <a
              href={(calFeedUrl || '').replace('https://', 'webcal://')}
              className="inline-flex items-center gap-1.5 text-sm text-teal-600 hover:text-teal-700 font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Open in Apple Calendar
            </a>
            <div className="text-xs text-gray-500 space-y-1">
              <p><strong>Apple Calendar:</strong> File \u2192 New Calendar Subscription \u2192 paste URL</p>
              <p><strong>Google Calendar:</strong> Other calendars \u2192 From URL \u2192 paste URL</p>
              <p><strong>Outlook:</strong> Add calendar \u2192 From internet \u2192 paste URL</p>
            </div>
            <button onClick={regenerateCalToken} disabled={calGenerating}
              className="text-xs text-red-500 hover:text-red-700 underline disabled:opacity-50">
              {calGenerating ? 'Regenerating...' : 'Regenerate Link (breaks existing subscriptions)'}
            </button>
          </div>
        )}
      </div>

      {/* Integrations */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Integrations</h2>
        </div>
        <div className="p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-white border border-gray-200 flex items-center justify-center shadow-sm shrink-0">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="2" y="4" width="20" height="18" rx="2" fill="white" stroke="#e0e0e0" strokeWidth="1.2"/>
                  <rect x="2" y="4" width="20" height="6" rx="2" fill="#1a73e8"/>
                  <rect x="2" y="8" width="20" height="2" fill="#1a73e8"/>
                  <rect x="6.5" y="1.5" width="2" height="5" rx="1" fill="#5f6368"/>
                  <rect x="15.5" y="1.5" width="2" height="5" rx="1" fill="#5f6368"/>
                  <text x="12" y="19" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#1a73e8" fontFamily="sans-serif">CAL</text>
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">Google Calendar</p>
                {gcalLoading ? (
                  <p className="text-xs text-gray-400">Checking connection\u2026</p>
                ) : gcal?.connected ? (
                  <p className="text-xs text-green-600 truncate">Connected \u00b7 {gcal.email}</p>
                ) : (
                  <p className="text-xs text-gray-400">Not connected \u2014 Harbor checks your calendar for availability</p>
                )}
              </div>
            </div>
            <div className="shrink-0">
              {gcalLoading ? (
                <div className="w-5 h-5 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
              ) : gcal?.connected ? (
                <button onClick={disconnectGcal} disabled={gcalDisconnecting}
                  className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors">
                  {gcalDisconnecting ? 'Disconnecting\u2026' : 'Disconnect'}
                </button>
              ) : (
                <a href="/api/integrations/google-calendar/auth"
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap">
                  <svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Connect Google Calendar
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
