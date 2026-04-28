// app/(reception)/reception/dashboard/page.tsx
//
// W48 T5 — Reception calls list. Read-only; reuses the existing
// /api/calls endpoint scoped to the practice.

'use client'

import { useEffect, useState } from 'react'

type Call = {
  id: string
  caller_phone: string | null
  duration_seconds: number | null
  outcome: string | null
  summary: string | null
  created_at: string
}

export default function ReceptionCallsPage() {
  const [calls, setCalls] = useState<Call[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/calls?limit=100')
        if (!res.ok) throw new Error(`Failed (${res.status})`)
        const j = await res.json()
        setCalls(j.calls || j.rows || [])
      } catch (e) {
        setError((e as Error).message)
      } finally { setLoading(false) }
    })()
  }, [])

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Calls</h1>
      {loading ? <p className="text-sm text-gray-500">Loading…</p>
      : error ? <p className="text-sm text-red-600">{error}</p>
      : calls.length === 0 ? <p className="text-sm text-gray-500">No calls yet. Call your number to test.</p>
      : (
        <ul className="bg-white border rounded divide-y">
          {calls.map((c) => (
            <li key={c.id} className="px-3 py-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="font-mono">{c.caller_phone || '—'}</span>
                <span className="text-xs text-gray-500">
                  {new Date(c.created_at).toLocaleString()}
                  {c.duration_seconds ? ` · ${Math.round(c.duration_seconds / 60)}m` : ''}
                </span>
              </div>
              {c.summary && <div className="text-xs text-gray-700 mt-1">{c.summary}</div>}
              {c.outcome && <div className="text-xs text-gray-500 mt-0.5">{c.outcome}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
