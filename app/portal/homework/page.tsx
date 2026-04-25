// app/portal/homework/page.tsx — patient views + checks off assigned homework.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, CheckCircle2, Circle, ListTodo } from 'lucide-react'

type Homework = {
  id: string
  title: string
  description: string | null
  due_date: string | null
  status: string
  completed_at: string | null
}

export default function PortalHomeworkPage() {
  const router = useRouter()
  const [items, setItems] = useState<Homework[] | null>(null)
  const [note, setNote] = useState<Record<string, string>>({})
  const [working, setWorking] = useState<string | null>(null)

  async function load() {
    const res = await fetch('/api/portal/homework')
    if (res.status === 401) { router.replace('/portal/login'); return }
    const json = await res.json()
    setItems(json.homework || [])
  }
  useEffect(() => { load() /* eslint-disable-line */ }, [])

  async function act(id: string, action: 'complete' | 'skip' | 'reopen') {
    setWorking(id)
    try {
      const res = await fetch(`/api/portal/homework/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, completion_note: note[id] || null }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      await load()
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed') }
    finally { setWorking(null) }
  }

  const open = (items ?? []).filter((h) => h.status === 'assigned')
  const done = (items ?? []).filter((h) => h.status !== 'assigned' && h.status !== 'cancelled')

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/portal/home" className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-900 mb-4">
        <ChevronLeft className="w-4 h-4" />
        Back to portal
      </Link>

      <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2 mb-4">
        <ListTodo className="w-6 h-6 text-teal-600" />
        Homework
      </h1>

      {items === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : open.length === 0 && done.length === 0 ? (
        <p className="text-sm text-gray-500">You have no homework right now.</p>
      ) : (
        <>
          {open.length > 0 && (
            <div className="space-y-3 mb-6">
              {open.map((h) => (
                <div key={h.id} className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex items-start gap-2">
                    <Circle className="w-5 h-5 text-gray-300 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{h.title}</div>
                      {h.description && <p className="text-sm text-gray-600 mt-1">{h.description}</p>}
                      {h.due_date && <p className="text-xs text-gray-400 mt-1">Due {new Date(h.due_date).toLocaleDateString()}</p>}
                    </div>
                  </div>
                  <div className="mt-3">
                    <textarea
                      placeholder="Optional note for your therapist (what went well, what was hard)"
                      rows={2}
                      value={note[h.id] || ''}
                      onChange={(e) => setNote((n) => ({ ...n, [h.id]: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <button
                        onClick={() => act(h.id, 'skip')}
                        disabled={working === h.id}
                        className="text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5"
                      >
                        Skip
                      </button>
                      <button
                        onClick={() => act(h.id, 'complete')}
                        disabled={working === h.id}
                        className="inline-flex items-center gap-1 text-xs bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-md disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {working === h.id ? 'Saving…' : 'Mark complete'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {done.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Completed</div>
              <ul className="space-y-1">
                {done.map((h) => (
                  <li key={h.id} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className={`w-4 h-4 ${h.status === 'completed' ? 'text-emerald-600' : 'text-gray-400'}`} />
                    <span className={h.status === 'completed' ? 'text-gray-700' : 'text-gray-400 line-through'}>
                      {h.title}
                    </span>
                    {h.completed_at && <span className="text-xs text-gray-400 ml-auto">{new Date(h.completed_at).toLocaleDateString()}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
