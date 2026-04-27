// components/ehr/PatientAISummaryCard.tsx
// "Briefing" card at the top of the patient profile. Sonnet reads the
// whole record + writes 3-5 sentences the therapist reads before the
// session. Cached on the patient row; regenerate on demand.
//
// Wave 38 M1: added `compact` prop so the card can render inside the
// PatientSummaryDrawer (slimmer chrome, no gradient frame, fits the
// drawer's own header).

'use client'

import { useEffect, useState } from 'react'
import { Sparkles, RefreshCw } from 'lucide-react'
import { usePreferences } from '@/lib/ehr/use-preferences'

type Data = { summary: string | null; generated_at: string | null; model?: string | null }

type Props = {
  patientId: string
  /**
   * Compact mode strips the gradient header/icon framing so the card can
   * sit inside a drawer (PatientSummaryDrawer) that already has its own
   * "Pre-session summary" title bar.
   */
  compact?: boolean
}

export function PatientAISummaryCard({ patientId, compact = false }: Props) {
  const { prefs } = usePreferences()
  const [data, setData] = useState<Data | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)

  async function load() {
    try {
      const r = await fetch(`/api/ehr/patients/${patientId}/summary`)
      if (r.status === 403) { setEnabled(false); return }
      if (r.ok) setData(await r.json())
    } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-line */ }, [patientId])

  async function regenerate() {
    setRegenerating(true)
    try {
      const r = await fetch(`/api/ehr/patients/${patientId}/summary`, { method: 'POST' })
      if (!r.ok) throw new Error((await r.json()).error || 'Failed')
      const j = await r.json()
      setData({ summary: j.summary, generated_at: j.generated_at })
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed') }
    finally { setRegenerating(false) }
  }

  if (!enabled) return null
  if (prefs && prefs.features.ai_draft === false) return null // reuse ai_draft feature flag

  if (loading) {
    return compact ? (
      <p className="text-sm text-gray-500 italic">Loading briefing…</p>
    ) : null
  }

  if (compact) {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wider text-teal-700 inline-flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> AI snapshot · 15-second read
          </span>
          <button
            onClick={regenerate}
            disabled={regenerating}
            className="inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-900 font-medium disabled:opacity-50 min-h-[44px] px-2"
            title={data?.summary ? 'Regenerate from latest data' : 'Generate'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} />
            {regenerating ? 'Thinking…' : data?.summary ? 'Refresh' : 'Generate'}
          </button>
        </div>
        {data?.summary ? (
          <div className="text-sm text-gray-900 leading-relaxed whitespace-pre-wrap">
            {data.summary}
          </div>
        ) : (
          <p className="text-sm text-gray-500 italic">
            Tap <strong className="text-teal-700">Generate</strong> — Claude will read this patient&apos;s record and write a 3-5 sentence snapshot you can skim before your next session.
          </p>
        )}
        {data?.generated_at && (
          <div className="text-[10px] text-teal-700 mt-2 opacity-70">
            Generated {new Date(data.generated_at).toLocaleString()}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-teal-50 via-white to-teal-50 border border-teal-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-teal-600 flex items-center justify-center text-white">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-teal-900">Pre-session briefing</div>
            <div className="text-[10px] uppercase tracking-wider text-teal-700">
              AI snapshot · 15-second read
            </div>
          </div>
        </div>
        <button
          onClick={regenerate}
          disabled={regenerating}
          className="inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-900 font-medium disabled:opacity-50"
          title={data?.summary ? 'Regenerate from latest data' : 'Generate'}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} />
          {regenerating ? 'Thinking…' : data?.summary ? 'Refresh' : 'Generate'}
        </button>
      </div>
      {data?.summary ? (
        <div className="text-sm text-gray-900 leading-relaxed whitespace-pre-wrap">
          {data.summary}
        </div>
      ) : (
        <p className="text-sm text-gray-500 italic">
          Click <strong className="text-teal-700">Generate</strong> — Claude will read this patient&apos;s record and write a 3-5 sentence snapshot you can skim before your next session.
        </p>
      )}
      {data?.generated_at && (
        <div className="text-[10px] text-teal-700 mt-2 opacity-70">
          Generated {new Date(data.generated_at).toLocaleString()}
        </div>
      )}
    </div>
  )
}
