// components/today/widgets/AIBrief.tsx
// W47 T0 — extracted from app/dashboard/page.tsx.

'use client'
import { useEffect, useState } from 'react'
import { Sparkles, RefreshCw } from 'lucide-react'

export default function AIBriefWidget() {
  const [brief, setBrief] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/dashboard/ai-brief')
      if (!r.ok) throw new Error(`Failed (${r.status})`)
      const j = await r.json()
      setBrief(j.brief || j.summary || '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load brief')
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  return (
    <div className="bg-gradient-to-br from-teal-50 via-white to-teal-50 border border-teal-200 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-teal-600 flex items-center justify-center text-white">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <span className="text-sm font-semibold text-teal-900">Your day in 90 seconds</span>
        </div>
        <button onClick={load} disabled={loading}
                className="inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-900 disabled:opacity-50"
                aria-label="Regenerate brief">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {loading && <p className="text-sm text-teal-800 italic">Reading your practice…</p>}
      {error && <p className="text-sm text-amber-800 italic">{error}</p>}
      {brief && !loading && (
        <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{brief}</p>
      )}
    </div>
  )
}
