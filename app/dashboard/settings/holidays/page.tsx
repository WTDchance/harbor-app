// app/dashboard/settings/holidays/page.tsx
//
// W43 T1 — practice holiday list + custom holiday management.
// Federal holidays are surfaced read-only; the form below lets the
// owner add closure days, training days, etc.

'use client'

import { useEffect, useState } from 'react'

type HolidayRow = { date: string; name: string; id?: string; notes?: string | null }

export default function PracticeHolidaysPage() {
  const [year, setYear] = useState<number>(new Date().getUTCFullYear())
  const [federal, setFederal] = useState<HolidayRow[]>([])
  const [custom, setCustom] = useState<HolidayRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ehr/practice/holidays?year=${year}`)
      if (!res.ok) throw new Error('Failed to load holidays')
      const j = await res.json()
      setFederal(j.federal || [])
      setCustom(j.custom || [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [year])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/ehr/practice/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, name, notes: notes || undefined }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to save')
      }
      setDate('')
      setName('')
      setNotes('')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Remove this holiday?')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/ehr/practice/holidays?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to remove')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Practice holidays</h1>
        <p className="text-sm text-gray-600 mt-1">
          Recurring appointments that fall on a holiday will be flagged so
          you can decide to keep, move, or cancel them. Federal holidays are
          included automatically; add your own closure days below.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Year</label>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="border rounded px-2 py-1"
        >
          {[year - 1, year, year + 1, year + 2].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Federal holidays ({year})</h2>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <ul className="border rounded divide-y">
            {federal.map((h) => (
              <li key={h.date} className="flex justify-between px-3 py-2 text-sm">
                <span>{h.name}</span>
                <span className="text-gray-500">{h.date}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Custom holidays ({year})</h2>
        {custom.length === 0 && !loading && (
          <p className="text-sm text-gray-500">No custom holidays yet.</p>
        )}
        {custom.length > 0 && (
          <ul className="border rounded divide-y">
            {custom.map((h) => (
              <li key={h.id} className="flex justify-between items-center px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{h.name}</div>
                  <div className="text-gray-500 text-xs">
                    {h.date}{h.notes ? ` · ${h.notes}` : ''}
                  </div>
                </div>
                <button
                  onClick={() => h.id && remove(h.id)}
                  className="text-red-600 hover:underline text-xs"
                  disabled={saving}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={add} className="border rounded p-3 space-y-2 bg-gray-50">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              Date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="block w-full border rounded px-2 py-1 mt-1"
              />
            </label>
            <label className="text-sm">
              Name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Office closed"
                className="block w-full border rounded px-2 py-1 mt-1"
              />
            </label>
          </div>
          <label className="text-sm block">
            Notes (optional)
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="block w-full border rounded px-2 py-1 mt-1"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Add holiday'}
          </button>
        </form>
      </section>
    </div>
  )
}
