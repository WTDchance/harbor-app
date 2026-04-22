// components/ehr/HomeworkCard.tsx
// Between-session homework on the patient profile. Therapist adds items
// inline; list shows open/completed status + completion notes from the
// patient's portal.

'use client'

import { useEffect, useState } from 'react'
import { ListTodo, Plus, CheckCircle2, Circle, X } from 'lucide-react'
import { usePreferences } from '@/lib/ehr/use-preferences'

type Homework = {
  id: string
  title: string
  description: string | null
  due_date: string | null
  status: string
  completed_at: string | null
  completion_note: string | null
  created_at: string
}

export function HomeworkCard({ patientId }: { patientId: string }) {
  const { prefs } = usePreferences()
  const [items, setItems] = useState<Homework[] | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [due, setDue] = useState('')
  const [working, setWorking] = useState(false)

  async function load() {
    try {
      const res = await fetch(`/api/ehr/homework?patient_id=${encodeURIComponent(patientId)}`)
      if (res.status === 403) { setEnabled(false); return }
      const json = await res.json()
      setItems(json.homework || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-line */ }, [patientId])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setWorking(true)
    try {
      const res = await fetch('/api/ehr/homework', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, title: title.trim(), description: desc || null, due_date: due || null }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      setTitle(''); setDesc(''); setDue(''); setAdding(false)
      await load()
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed') }
    finally { setWorking(false) }
  }

  async function cancel(id: string) {
    const res = await fetch(`/api/ehr/homework/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    })
    if (res.ok) await load()
  }

  if (!enabled || loading) return null
  if (prefs && prefs.features.homework === false) return null

  const open = (items ?? []).filter((h) => h.status === 'assigned')
  const done = (items ?? []).filter((h) => h.status === 'completed' || h.status === 'skipped')

  return (
    <div className="bg-white border rounded-lg p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-gray-500" />
          Between-session homework
          {open.length > 0 && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">
              {open.length} open
            </span>
          )}
        </h2>
        <button
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm bg-teal-600 text-white px-3 py-1.5 rounded-md hover:bg-teal-700"
        >
          <Plus className="w-3.5 h-3.5" />
          Assign
        </button>
      </div>

      {adding && (
        <form onSubmit={submit} className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
          <input
            value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Assignment title (required)"
            required
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <textarea
            value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Details (optional): the specific instructions for the patient"
            rows={2}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-700">Due:</label>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <div className="flex-1" />
            <button type="button" onClick={() => setAdding(false)} className="text-xs text-gray-600 px-3 py-1.5">Cancel</button>
            <button type="submit" disabled={working}
              className="text-xs bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-md disabled:opacity-50">
              {working ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        </form>
      )}

      {open.length === 0 && done.length === 0 && (
        <p className="text-sm text-gray-500">No homework assigned yet.</p>
      )}

      {open.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {open.map((h) => (
            <li key={h.id} className="py-2 flex items-start gap-3">
              <Circle className="w-4 h-4 text-gray-300 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">{h.title}</div>
                {h.description && <div className="text-xs text-gray-600 mt-0.5">{h.description}</div>}
                <div className="text-xs text-gray-400 mt-0.5">
                  {h.due_date ? `Due ${new Date(h.due_date).toLocaleDateString()}` : 'No due date'}
                </div>
              </div>
              <button onClick={() => cancel(h.id)} className="text-xs text-gray-400 hover:text-red-600" title="Cancel assignment">
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Completed / skipped</div>
          <ul className="space-y-1">
            {done.slice(0, 5).map((h) => (
              <li key={h.id} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${h.status === 'completed' ? 'text-emerald-600' : 'text-gray-400'}`} />
                <div className="flex-1">
                  <div className={`${h.status === 'completed' ? 'text-gray-700' : 'text-gray-400 line-through'} text-xs`}>
                    {h.title}
                    {h.completed_at && <span className="text-gray-400 ml-1">· {new Date(h.completed_at).toLocaleDateString()}</span>}
                  </div>
                  {h.completion_note && (
                    <div className="text-[11px] text-gray-600 italic mt-0.5">&ldquo;{h.completion_note}&rdquo;</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
