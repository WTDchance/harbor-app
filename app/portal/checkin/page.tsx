// app/portal/checkin/page.tsx
//
// W46 T5 — patient-side daily check-in.

'use client'

import { useEffect, useState } from 'react'

const MOODS = [
  { score: 1, emoji: '😞', label: 'Very low' },
  { score: 2, emoji: '😕', label: 'Low' },
  { score: 3, emoji: '😐', label: 'Neutral' },
  { score: 4, emoji: '🙂', label: 'Good' },
  { score: 5, emoji: '😄', label: 'Great' },
]

const DEFAULT_SYMPTOMS = [
  'anxiety', 'low mood', 'irritable', 'tired', 'sleep trouble',
  'appetite changes', 'racing thoughts', 'physical pain',
]

export default function CheckinPage() {
  const [today, setToday] = useState<any>(null)
  const [reminderEnabled, setReminderEnabled] = useState(false)
  const [mood, setMood] = useState<number | null>(null)
  const [symptoms, setSymptoms] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/portal/checkin')
      if (!res.ok) return
      const j = await res.json()
      setToday(j.today)
      setReminderEnabled(!!j.reminder_enabled)
      if (j.today) {
        setMood(j.today.mood_score)
        setSymptoms(j.today.symptoms || [])
        setNote(j.today.note || '')
      }
    } catch {}
  }
  useEffect(() => { void load() }, [])

  async function submit() {
    if (!mood) return
    setSaving(true); setError(null); setSavedNote(null)
    try {
      const res = await fetch('/api/portal/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood_score: mood, symptoms, note }),
      })
      if (!res.ok) throw new Error('Save failed')
      setSavedNote('Saved. Thanks for checking in.')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function optOut() {
    if (!confirm('Turn off daily check-in reminders?')) return
    await fetch('/api/portal/checkin', { method: 'DELETE' })
    setReminderEnabled(false)
  }

  function toggleSymptom(s: string) {
    setSymptoms((cur) => cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s])
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Daily check-in</h1>
        <p className="text-sm text-gray-600 mt-1">
          {today ? "Update today's check-in." : "How are you doing today?"}
        </p>
      </div>

      <section className="rounded border bg-white p-3 space-y-3">
        <div>
          <div className="text-sm font-medium mb-2">Mood</div>
          <div className="flex justify-between gap-1">
            {MOODS.map((m) => (
              <button
                key={m.score}
                onClick={() => setMood(m.score)}
                className={`flex-1 py-3 rounded border text-2xl ${
                  mood === m.score ? 'border-[#1f375d] bg-blue-50' : 'border-gray-200 bg-white'
                }`}
                title={m.label}
              >
                {m.emoji}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium mb-2">Symptoms (optional)</div>
          <div className="flex flex-wrap gap-1.5">
            {DEFAULT_SYMPTOMS.map((s) => {
              const on = symptoms.includes(s)
              return (
                <button
                  key={s}
                  onClick={() => toggleSymptom(s)}
                  className={`text-xs px-2 py-1 rounded-full border ${
                    on ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300'
                  }`}
                >
                  {s}
                </button>
              )
            })}
          </div>
        </div>

        <label className="block text-sm">
          Note (optional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything you want your therapist to know?"
            className="block w-full border rounded px-2 py-1 mt-1 text-sm"
            rows={3}
          />
        </label>

        <button
          onClick={submit}
          disabled={!mood || saving}
          className="bg-[#1f375d] text-white px-3 py-2 rounded text-sm disabled:opacity-50 w-full"
        >
          {saving ? 'Saving…' : (today ? 'Update' : 'Submit')}
        </button>

        {error && (
          <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        {savedNote && (
          <div className="rounded bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">{savedNote}</div>
        )}
      </section>

      {reminderEnabled && (
        <button onClick={optOut} className="text-xs text-gray-500 hover:underline">
          Turn off daily reminders
        </button>
      )}
    </div>
  )
}
