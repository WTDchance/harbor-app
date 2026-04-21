'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { Calendar, ChevronLeft, ChevronRight, Plus, X, Check } from 'lucide-react'
import Link from 'next/link'

interface Appointment {
  id: string
  patient_name: string
  appointment_date: string
  appointment_time: string
  duration_minutes: number
  appointment_type: string
  status: string
}

interface CalendarConnection {
  id: string
  provider: string
  label: string
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-500',
  confirmed: 'bg-green-500',
  cancelled: 'bg-red-400',
  completed: 'bg-gray-400',
  no_show: 'bg-yellow-500',
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function buildCalendarDays(year: number, month: number): Date[] {
  const days: Date[] = []
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startDow = firstDay.getDay()
  for (let i = startDow; i > 0; i--) {
    days.push(new Date(year, month, 1 - i))
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d))
  }
  while (days.length % 7 !== 0) {
    const last = days[days.length - 1]
    days.push(new Date(last.getTime() + 86400000))
  }
  return days
}

function toDateStr(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

export default function CalendarPage() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [connectModal, setConnectModal] = useState<string | null>(null)
  const [caldavForm, setCaldavForm] = useState({ email: '', password: '', name: '' })
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [connections, setConnections] = useState<CalendarConnection[]>([])

  // Harbor ICS feed state — read-only subscription URL per practice.
  const [feedUrls, setFeedUrls] = useState<{ https: string; webcal: string } | null>(null)
  const [feedLoading, setFeedLoading] = useState(true)
  const [feedCopied, setFeedCopied] = useState(false)
  const [feedRegenerating, setFeedRegenerating] = useState(false)
  const [feedRevision, setFeedRevision] = useState(0)

  const supabase = createClient()
  const days = buildCalendarDays(year, month)
  const monthStart = toDateStr(new Date(year, month, 1))
  const monthEnd = toDateStr(new Date(year, month + 1, 0))

  useEffect(() => {
    fetchAppointments()
    fetchConnections()
  }, [year, month])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setFeedLoading(true)
      try {
        const res = await fetch('/api/calendar/ics-token')
        if (!res.ok) throw new Error('fetch failed')
        const data = await res.json()
        if (!cancelled) setFeedUrls({ https: data.https_url, webcal: data.webcal_url })
      } catch {
        if (!cancelled) setFeedUrls(null)
      } finally {
        if (!cancelled) setFeedLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [feedRevision])

  async function regenerateFeed() {
    if (!confirm('Regenerate the feed URL? Subscribed calendar apps will stop syncing and need the new URL.')) return
    setFeedRegenerating(true)
    try {
      const res = await fetch('/api/calendar/ics-token', { method: 'POST' })
      if (!res.ok) throw new Error('regen failed')
      const data = await res.json()
      setFeedUrls({ https: data.https_url, webcal: data.webcal_url })
      setFeedRevision(r => r + 1)
    } catch {
      alert('Failed to regenerate. Try again or contact support.')
    } finally {
      setFeedRegenerating(false)
    }
  }

  function copyFeedUrl() {
    if (!feedUrls) return
    navigator.clipboard.writeText(feedUrls.webcal).then(() => {
      setFeedCopied(true)
      setTimeout(() => setFeedCopied(false), 2000)
    })
  }

  async function fetchAppointments() {
    setLoading(true)
    try {
      const r = await fetch(`/api/appointments?start=${monthStart}&end=${monthEnd}`)
      const d = await r.json()
      setAppointments(d.appointments || [])
    } catch {}
    setLoading(false)
  }

  async function fetchConnections() {
    try {
      // Resolve practice via server-side endpoint (respects act-as cookie)
      const meRes = await fetch('/api/practice/me')
      if (!meRes.ok) return
      const meData = await meRes.json()
      const practiceId = meData.practice?.id
      if (!practiceId) return
      const { data } = await supabase
        .from('calendar_connections').select('*').eq('practice_id', practiceId)
      setConnections(data || [])
    } catch {}
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }

  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  async function handleCalDAVConnect() {
    setSaving(true)
    setSaveMsg('')
    try {
      const r = await fetch('/api/calendar/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'apple', ...caldavForm }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Connection failed')
      setSaveMsg('success')
      setTimeout(() => { setConnectModal(null); setSaveMsg(''); fetchConnections() }, 1200)
    } catch (e: any) {
      setSaveMsg(e.message)
    }
    setSaving(false)
  }

  const apptsByDate = appointments.reduce((acc, a) => {
    if (!acc[a.appointment_date]) acc[a.appointment_date] = []
    acc[a.appointment_date].push(a)
    return acc
  }, {} as Record<string, Appointment[]>)

  const todayStr = toDateStr(today)

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Calendar className="w-8 h-8 text-teal-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Calendar</h1>
            <p className="text-sm text-gray-500">View appointments and sync external calendars</p>
          </div>
        </div>
        <Link
          href="/dashboard/appointments"
          className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          New Appointment
        </Link>
      </div>

      {/* Harbor ICS subscription feed */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Subscribe to your Harbor calendar</h2>
            <p className="text-xs text-gray-500 mt-1">One URL per practice. Paste into Apple Calendar, Google Calendar, or Outlook to see all Harbor appointments natively. PHI is minimized — event titles are &ldquo;Harbor appointment&rdquo; with a reference ID; full details stay in Harbor.</p>
          </div>
          {feedUrls && (
            <button
              onClick={regenerateFeed}
              disabled={feedRegenerating}
              className="text-xs text-gray-500 hover:text-gray-700 underline disabled:opacity-50 whitespace-nowrap"
              title="Revokes existing subscribers"
            >
              {feedRegenerating ? 'Regenerating\u2026' : 'Regenerate URL'}
            </button>
          )}
        </div>
        {feedLoading ? (
          <div className="h-20 flex items-center justify-center text-sm text-gray-400">Loading feed\u2026</div>
        ) : !feedUrls ? (
          <div className="h-20 flex items-center justify-center text-sm text-red-500">Feed unavailable. Refresh or contact support.</div>
        ) : (
          <div className="flex flex-col md:flex-row gap-5 items-start">
            <div className="flex-1 min-w-0 w-full">
              <label className="block text-xs font-medium text-gray-600 mb-1">Subscription URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={feedUrls.webcal}
                  onClick={e => (e.target as HTMLInputElement).select()}
                  className="flex-1 min-w-0 px-3 py-2 text-xs font-mono bg-gray-50 border border-gray-200 rounded-lg text-gray-700"
                />
                <button
                  onClick={copyFeedUrl}
                  className="px-3 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg whitespace-nowrap"
                >
                  {feedCopied ? '\u2713 Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">Tip: tap the URL on your phone to add it to Apple Calendar or Google Calendar automatically.</p>
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Setup instructions for Apple, Google, and Outlook</summary>
                <div className="mt-2 space-y-2 text-gray-600 pl-2 border-l-2 border-gray-100">
                  <p><strong>iPhone/Mac (Apple Calendar):</strong> tap the URL above on your phone, or scan the QR code. Confirm &ldquo;Subscribe&rdquo;.</p>
                  <p><strong>Google Calendar:</strong> click &ldquo;Other calendars&rdquo; &rarr; &ldquo;From URL&rdquo; and paste the <code className="bg-gray-100 px-1 rounded">{feedUrls.https}</code> form.</p>
                  <p><strong>Outlook:</strong> File &rarr; Account Settings &rarr; Internet Calendars &rarr; New &rarr; paste the URL.</p>
                </div>
              </details>
            </div>
            <div className="flex flex-col items-center gap-2 shrink-0">
              <img
                src={`/api/calendar/ics-qr?v=${feedRevision}`}
                alt="QR code for Harbor calendar subscription"
                className="w-32 h-32 md:w-40 md:h-40 rounded-lg border border-gray-200 bg-white p-1"
              />
              <p className="text-xs text-gray-400">Scan on phone</p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Calendar Connections</h2>
        <div className="grid grid-cols-3 gap-3">
          {[
            { id: 'apple', label: 'Apple Calendar', sub: 'iCloud CalDAV', emoji: '🍎', btnClass: 'bg-gray-900 hover:bg-gray-800 text-white' },
            { id: 'google', label: 'Google Calendar', sub: 'OAuth 2.0', emoji: '📅', btnClass: 'bg-blue-500 hover:bg-blue-600 text-white' },
            { id: 'outlook', label: 'Outlook Calendar', sub: 'Microsoft Graph', emoji: '📆', btnClass: 'bg-blue-700 hover:bg-blue-800 text-white' },
          ].map(cal => {
            const connected = connections.some(c => c.provider === cal.id)
            return (
              <div key={cal.id} className="border border-gray-100 rounded-xl p-4 hover:border-gray-200 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-xl border border-gray-100">
                    {cal.emoji}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{cal.label}</p>
                    <p className="text-xs text-gray-400">{cal.sub}</p>
                  </div>
                </div>
                {connected ? (
                  <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
                    <Check className="w-3.5 h-3.5" /> Connected
                  </div>
                ) : (
                  <button
                    onClick={() => setConnectModal(cal.id)}
                    className={`w-full text-xs py-2 rounded-lg transition-colors font-medium ${cal.btnClass}`}
                  >
                    Connect
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <button onClick={prevMonth} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <div className="text-center">
            <h2 className="text-lg font-semibold text-gray-900">{MONTH_NAMES[month]} {year}</h2>
            {year === today.getFullYear() && month === today.getMonth() && (
              <p className="text-xs text-teal-600">This month</p>
            )}
          </div>
          <button onClick={nextMonth} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50">
          {DOW.map(d => (
            <div key={d} className="py-2.5 text-center text-xs font-medium text-gray-400 uppercase tracking-wide">
              {d}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {days.map((day, idx) => {
              const dateStr = toDateStr(day)
              const isCurrentMonth = day.getMonth() === month
              const isToday = dateStr === todayStr
              const dayAppts = apptsByDate[dateStr] || []
              return (
                <div
                  key={idx}
                  className={`min-h-[100px] p-2 border-b border-r border-gray-100 ${!isCurrentMonth ? 'bg-gray-50/60' : 'hover:bg-gray-50/40'} transition-colors`}
                >
                  <div className={`w-7 h-7 flex items-center justify-center rounded-full text-sm font-medium mb-1 ${
                    isToday
                      ? 'bg-teal-600 text-white'
                      : isCurrentMonth ? 'text-gray-900' : 'text-gray-300'
                  }`}>
                    {day.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dayAppts.slice(0, 3).map(a => (
                      <div
                        key={a.id}
                        className={`text-xs px-1.5 py-0.5 rounded truncate text-white leading-5 ${STATUS_COLORS[a.status] || 'bg-teal-500'}`}
                        title={`${a.appointment_time.slice(0, 5)} - ${a.patient_name}`}
                      >
                        {a.appointment_time.slice(0, 5)} {a.patient_name.split(' ')[0]}
                      </div>
                    ))}
                    {dayAppts.length > 3 && (
                      <p className="text-xs text-gray-400 pl-0.5">+{dayAppts.length - 3} more</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-gray-500">
        {[
          { label: 'Scheduled', color: 'bg-blue-500' },
          { label: 'Confirmed', color: 'bg-green-500' },
          { label: 'Completed', color: 'bg-gray-400' },
          { label: 'Cancelled', color: 'bg-red-400' },
          { label: 'No Show', color: 'bg-yellow-500' },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${s.color}`} />
            {s.label}
          </div>
        ))}
      </div>

      {connectModal === 'apple' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🍎</span>
                <h2 className="text-lg font-semibold">Connect Apple Calendar</h2>
              </div>
              <button onClick={() => { setConnectModal(null); setSaveMsg('') }}>
                <X className="w-5 h-5 text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-sm text-amber-800">
                <strong>Important:</strong> Use an app-specific password from{' '}
                <a href="https://appleid.apple.com" target="_blank" rel="noopener noreferrer" className="underline font-medium">
                  appleid.apple.com
                </a>
                {' '}→ Sign-In and Security → App-Specific Passwords. Do not use your main Apple ID password.
              </div>
              {saveMsg && saveMsg !== 'success' && (
                <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg">{saveMsg}</div>
              )}
              {saveMsg === 'success' && (
                <div className="bg-green-50 text-green-700 text-sm p-3 rounded-lg flex items-center gap-2">
                  <Check className="w-4 h-4" /> Connected successfully!
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Apple ID (iCloud email)</label>
                <input
                  type="email"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                  value={caldavForm.email}
                  onChange={e => setCaldavForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="your@icloud.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">App-specific password</label>
                <input
                  type="password"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                  value={caldavForm.password}
                  onChange={e => setCaldavForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="xxxx-xxxx-xxxx-xxxx"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Label (optional)</label>
                <input
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                  value={caldavForm.name}
                  onChange={e => setCaldavForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Dr. Trace's Calendar"
                />
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => { setConnectModal(null); setSaveMsg('') }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleCalDAVConnect}
                disabled={saving || !caldavForm.email || !caldavForm.password}
                className="px-6 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Connecting...' : 'Connect Calendar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {connectModal === 'google' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 text-center">
            <div className="text-5xl mb-4">📅</div>
            <h2 className="text-lg font-semibold mb-2 text-gray-900">Google Calendar</h2>
            <p className="text-sm text-gray-500 mb-6">
              Google Calendar OAuth integration is coming soon. You will be able to authorize Harbor with one click and Ellie will read and write your Google Calendar automatically.
            </p>
            <button
              onClick={() => setConnectModal(null)}
              className="px-6 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700 transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {connectModal === 'outlook' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 text-center">
            <div className="text-5xl mb-4">📆</div>
            <h2 className="text-lg font-semibold mb-2 text-gray-900">Outlook Calendar</h2>
            <p className="text-sm text-gray-500 mb-6">
              Microsoft Outlook integration via Microsoft Graph is coming soon. Authorize Harbor with your Microsoft account and Ellie will have full read and write access to your Outlook Calendar.
            </p>
            <button
              onClick={() => setConnectModal(null)}
              className="px-6 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700 transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
