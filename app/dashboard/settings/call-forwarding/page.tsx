'use client'

// Call forwarding settings page.
// Lets the practice owner configure when calls forward to their personal cell
// vs. when Ellie answers.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

type Mode = 'off' | 'always' | 'schedule' | 'after_hours'
type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
type ScheduleEntry = { day: Day; start: string; end: string }
type Fallback = 'ellie' | 'voicemail'

const DAYS: { key: Day; label: string }[] = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

const DEFAULT_BUSINESS_HOURS: ScheduleEntry[] = [
  { day: 'mon', start: '09:00', end: '17:00' },
  { day: 'tue', start: '09:00', end: '17:00' },
  { day: 'wed', start: '09:00', end: '17:00' },
  { day: 'thu', start: '09:00', end: '17:00' },
  { day: 'fri', start: '09:00', end: '17:00' },
]

export default function CallForwardingPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [practiceId, setPracticeId] = useState<string | null>(null)

  const [enabled, setEnabled] = useState(false)
  const [mode, setMode] = useState<Mode>('off')
  const [number, setNumber] = useState('')
  const [fallback, setFallback] = useState<Fallback>('ellie')
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([])
  const [businessHours, setBusinessHours] = useState<ScheduleEntry[]>(DEFAULT_BUSINESS_HOURS)

  // Load current settings
  useEffect(() => {
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setError('Not signed in'); setLoading(false); return }

        const { data: userRow } = await supabase
          .from('users')
          .select('practice_id')
          .eq('id', user.id)
          .single()

        if (!userRow?.practice_id) { setError('No practice associated'); setLoading(false); return }
        setPracticeId(userRow.practice_id)

        const { data: practice, error: pErr } = await supabase
          .from('practices')
          .select(`
            call_forwarding_enabled,
            call_forwarding_mode,
            call_forwarding_number,
            call_forwarding_schedule,
            call_forwarding_fallback,
            business_hours
          `)
          .eq('id', userRow.practice_id)
          .single()

        if (pErr || !practice) throw pErr || new Error('Practice not found')

        setEnabled(practice.call_forwarding_enabled ?? false)
        setMode((practice.call_forwarding_mode as Mode) ?? 'off')
        setNumber(practice.call_forwarding_number ?? '')
        setFallback((practice.call_forwarding_fallback as Fallback) ?? 'ellie')
        setSchedule((practice.call_forwarding_schedule as ScheduleEntry[]) ?? [])
        setBusinessHours((practice.business_hours as ScheduleEntry[]) ?? DEFAULT_BUSINESS_HOURS)
      } catch (e: any) {
        setError(e.message ?? 'Failed to load settings')
      } finally {
        setLoading(false)
      }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function normalizeNumber(v: string): string {
    // Strip everything except digits and leading +
    const trimmed = v.trim()
    if (trimmed.startsWith('+')) return '+' + trimmed.slice(1).replace(/\D/g, '')
    const digits = trimmed.replace(/\D/g, '')
    if (digits.length === 10) return '+1' + digits
    if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
    return trimmed
  }

  async function save() {
    if (!practiceId) return
    setSaving(true)
    setError(null)
    try {
      const normalizedNumber = number ? normalizeNumber(number) : null
      if (enabled && (!normalizedNumber || normalizedNumber.length < 11)) {
        throw new Error('A valid forwarding number is required when forwarding is enabled')
      }

      const { error: updateErr } = await supabase
        .from('practices')
        .update({
          call_forwarding_enabled: enabled,
          call_forwarding_mode: mode,
          call_forwarding_number: normalizedNumber,
          call_forwarding_fallback: fallback,
          call_forwarding_schedule: schedule,
          business_hours: businessHours,
        })
        .eq('id', practiceId)

      if (updateErr) throw updateErr
      setSavedAt(new Date())
      setNumber(normalizedNumber || '')
    } catch (e: any) {
      setError(e.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function updateScheduleEntry(idx: number, patch: Partial<ScheduleEntry>) {
    setSchedule(s => s.map((e, i) => i === idx ? { ...e, ...patch } : e))
  }
  function addScheduleEntry() {
    setSchedule(s => [...s, { day: 'mon', start: '09:00', end: '17:00' }])
  }
  function removeScheduleEntry(idx: number) {
    setSchedule(s => s.filter((_, i) => i !== idx))
  }

  function updateBusinessHourEntry(idx: number, patch: Partial<ScheduleEntry>) {
    setBusinessHours(h => h.map((e, i) => i === idx ? { ...e, ...patch } : e))
  }
  function addBusinessHourEntry() {
    setBusinessHours(h => [...h, { day: 'mon', start: '09:00', end: '17:00' }])
  }
  function removeBusinessHourEntry(idx: number) {
    setBusinessHours(h => h.filter((_, i) => i !== idx))
  }

  if (loading) return <div className="p-8">Loading…</div>

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Call Forwarding</h1>
        <p className="text-slate-600 mt-1">
          Decide when Ellie answers calls and when calls go straight to your cell.
        </p>
      </header>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 p-3 text-sm">
          {error}
        </div>
      )}

      {/* Master toggle */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <div className="font-medium text-slate-900">Enable call forwarding</div>
            <div className="text-sm text-slate-600">Master switch. When off, Ellie answers every call.</div>
          </div>
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            className="h-5 w-5"
          />
        </label>
      </section>

      {/* Forwarding number */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
        <div>
          <label className="block text-sm font-medium text-slate-900">Forward calls to</label>
          <p className="text-xs text-slate-600 mb-2">Your personal cell. Use 10-digit US format or +country.</p>
          <input
            type="tel"
            value={number}
            onChange={e => setNumber(e.target.value)}
            placeholder="(541) 892-0518"
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </div>
      </section>

      {/* Mode picker */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
        <div className="font-medium text-slate-900">When to forward</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([
            { key: 'always', title: 'Always', desc: 'Forward every call. Ellie does not answer.' },
            { key: 'schedule', title: 'On a schedule', desc: 'Forward only during the times you set below.' },
            { key: 'after_hours', title: 'After hours only', desc: 'Forward outside your business hours. Ellie covers you during work.' },
            { key: 'off', title: 'Off (Ellie always answers)', desc: 'Disables forwarding logic — Ellie handles everything.' },
          ] as { key: Mode; title: string; desc: string }[]).map(opt => (
            <label
              key={opt.key}
              className={`rounded-lg border p-3 cursor-pointer ${mode === opt.key ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}
            >
              <div className="flex items-start gap-2">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === opt.key}
                  onChange={() => setMode(opt.key)}
                  className="mt-1"
                />
                <div>
                  <div className="text-sm font-medium text-slate-900">{opt.title}</div>
                  <div className="text-xs text-slate-600">{opt.desc}</div>
                </div>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* Schedule editor */}
      {mode === 'schedule' && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
          <div className="font-medium text-slate-900">Forwarding schedule</div>
          <p className="text-xs text-slate-600">Calls during these windows go to your cell. All other times, Ellie answers.</p>
          {schedule.length === 0 && (
            <div className="text-sm text-slate-500 italic">No windows yet. Add one below.</div>
          )}
          {schedule.map((entry, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                value={entry.day}
                onChange={e => updateScheduleEntry(idx, { day: e.target.value as Day })}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              >
                {DAYS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
              <input
                type="time"
                value={entry.start}
                onChange={e => updateScheduleEntry(idx, { start: e.target.value })}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <span className="text-slate-500">to</span>
              <input
                type="time"
                value={entry.end}
                onChange={e => updateScheduleEntry(idx, { end: e.target.value })}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={() => removeScheduleEntry(idx)}
                className="text-xs text-red-600 hover:underline ml-auto"
              >Remove</button>
            </div>
          ))}
          <button
            type="button"
            onClick={addScheduleEntry}
            className="text-sm text-blue-600 hover:underline"
          >+ Add time window</button>
        </section>
      )}

      {/* Business hours editor (used by after_hours mode) */}
      {mode === 'after_hours' && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
          <div className="font-medium text-slate-900">Your business hours</div>
          <p className="text-xs text-slate-600">Ellie answers during these hours. Outside of them, calls forward to your cell.</p>
          {businessHours.map((entry, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                value={entry.day}
                onChange={e => updateBusinessHourEntry(idx, { day: e.target.value as Day })}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              >
                {DAYS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
              <input
                type="time"
                value={entry.start}
                onChange={e => updateBusinessHourEntry(idx, { start: e.target.value })}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <span className="text-slate-500">to</span>
              <input
                type="time"
                value={entry.end}
                onChange={e => updateBusinessHourEntry(idx, { end: e.target.value })}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={() => removeBusinessHourEntry(idx)}
                className="text-xs text-red-600 hover:underline ml-auto"
              >Remove</button>
            </div>
          ))}
          <button
            type="button"
            onClick={addBusinessHourEntry}
            className="text-sm text-blue-600 hover:underline"
          >+ Add hours</button>
        </section>
      )}

      {/* Fallback behavior */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
        <div className="font-medium text-slate-900">If you don't pick up</div>
        <div className="space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="fallback"
              checked={fallback === 'ellie'}
              onChange={() => setFallback('ellie')}
              className="mt-1"
            />
            <div>
              <div className="text-sm font-medium text-slate-900">Ellie picks up (recommended)</div>
              <div className="text-xs text-slate-600">If you don't answer within 20 seconds, Ellie takes over so the caller still gets help.</div>
            </div>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="fallback"
              checked={fallback === 'voicemail'}
              onChange={() => setFallback('voicemail')}
              className="mt-1"
            />
            <div>
              <div className="text-sm font-medium text-slate-900">Send to voicemail</div>
              <div className="text-xs text-slate-600">Caller leaves a voicemail Harbor will deliver to you.</div>
            </div>
          </label>
        </div>
      </section>

      {/* Save bar */}
      <div className="sticky bottom-0 bg-white border-t border-slate-200 -mx-8 px-8 py-4 flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {savedAt ? `Saved at ${savedAt.toLocaleTimeString()}` : 'Unsaved changes'}
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
