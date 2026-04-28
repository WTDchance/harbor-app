// app/(reception)/reception/dashboard/agent-config/page.tsx
//
// W48 T5 — Retell agent config. Edit system prompt + voice settings.
// Uses the existing /api/admin/retell-config endpoint family for the
// CRUD; falls back to a textarea + save button if the existing
// W42 ai-receptionist editor isn't reusable as-is.

'use client'

import { useEffect, useState } from 'react'

export default function AgentConfigPage() {
  const [systemPrompt, setSystemPrompt] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/admin/retell-config')
        if (!res.ok) throw new Error(`Failed (${res.status})`)
        const j = await res.json()
        setSystemPrompt(j.system_prompt || j.prompt || '')
      } catch (e) {
        setError((e as Error).message)
      } finally { setLoading(false) }
    })()
  }, [])

  async function save() {
    setSaving(true); setError(null); setSavedNote(null)
    try {
      const res = await fetch('/api/admin/retell-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_prompt: systemPrompt }),
      })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      setSavedNote('Saved.'); setTimeout(() => setSavedNote(null), 3000)
    } catch (e) {
      setError((e as Error).message)
    } finally { setSaving(false) }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Agent config</h1>
        <p className="text-sm text-gray-600 mt-1">
          What should your AI receptionist say and do? This is the
          system prompt the model receives on every call.
        </p>
      </div>
      {loading ? <p className="text-sm text-gray-500">Loading…</p> : (
        <div className="space-y-2">
          <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)}
                    rows={20}
                    className="block w-full border rounded px-3 py-2 text-sm font-mono" />
          <button onClick={save} disabled={saving}
                  className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {savedNote && <p className="text-sm text-green-700">{savedNote}</p>}
        </div>
      )}
    </div>
  )
}
