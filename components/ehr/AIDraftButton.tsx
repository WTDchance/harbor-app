// components/ehr/AIDraftButton.tsx
// One button, one modal, two input modes:
//   1. Brief (default)   — therapist types a few sentences about the session,
//                          Sonnet turns it into a full SOAP draft.
//   2. From a call       — fallback for intake calls or when the therapist
//                          wants to document a phone contact rather than a
//                          session. Picks from recent calls with transcripts.
//
// Either mode produces a new draft progress note and redirects to its
// detail page for review / edit / sign.

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, X, AlertTriangle, Mic, Phone } from 'lucide-react'

type Tab = 'brief' | 'call'

type Call = {
  id: string
  created_at: string
  duration_seconds: number | null
  call_type: string | null
  summary: string | null
  crisis_detected: boolean | null
}

export function AIDraftButton({ patientId }: { patientId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('brief')
  const [brief, setBrief] = useState('')
  const [calls, setCalls] = useState<Call[] | null>(null)
  const [loadingCalls, setLoadingCalls] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lazy-load the call list when the user switches tabs.
  useEffect(() => {
    if (!open || tab !== 'call' || calls !== null) return
    let cancelled = false
    async function load() {
      setLoadingCalls(true)
      try {
        const res = await fetch(
          `/api/ehr/notes/draft-from-call/candidates?patient_id=${encodeURIComponent(patientId)}`,
        )
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Failed to load calls')
        if (!cancelled) setCalls(json.calls || [])
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load calls')
          setCalls([])
        }
      } finally {
        if (!cancelled) setLoadingCalls(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [open, tab, calls, patientId])

  function reset() {
    setOpen(false)
    setTab('brief')
    setBrief('')
    setError(null)
    setDrafting(false)
    setCalls(null)
  }

  async function submitBrief() {
    if (brief.trim().length < 4) {
      setError('Add a few words about the session first.')
      return
    }
    setDrafting(true)
    setError(null)
    try {
      const res = await fetch('/api/ehr/notes/draft-from-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, brief }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Draft failed')
      router.push(`/dashboard/ehr/notes/${json.note.id}?drafted=1`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Draft failed')
      setDrafting(false)
    }
  }

  async function submitCall(callId: string) {
    setDrafting(true)
    setError(null)
    try {
      const res = await fetch('/api/ehr/notes/draft-from-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_log_id: callId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Draft failed')
      router.push(`/dashboard/ehr/notes/${json.note.id}?drafted=1`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Draft failed')
      setDrafting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-sm bg-white border border-teal-600 text-teal-700 px-3 py-1.5 rounded-md hover:bg-teal-50 transition"
      >
        <Sparkles className="w-3.5 h-3.5" />
        AI Draft
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !drafting && reset()}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-teal-600" />
                  AI Draft
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Claude turns a brief description into a full SOAP draft. You review, edit, and sign.
                </p>
              </div>
              {!drafting && (
                <button type="button" onClick={reset} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-gray-200 mb-4">
              <TabButton
                active={tab === 'brief'}
                onClick={() => setTab('brief')}
                disabled={drafting}
                icon={<Mic className="w-3.5 h-3.5" />}
              >
                From a brief
              </TabButton>
              <TabButton
                active={tab === 'call'}
                onClick={() => setTab('call')}
                disabled={drafting}
                icon={<Phone className="w-3.5 h-3.5" />}
              >
                From a call
              </TabButton>
            </div>

            {error && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                {error}
              </div>
            )}

            {tab === 'brief' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Describe what happened in the session
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  A few sentences is enough. Mention what was discussed, any techniques used, homework assigned, and anything notable. Claude fills in the rest using clinical language.
                </p>
                <textarea
                  disabled={drafting}
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  rows={7}
                  placeholder="e.g. Session 5. Worked on breathing techniques for panic. Patient discussed ongoing conflict with spouse and difficulty sleeping. Assigned thought-log homework for the week. Patient engaged and motivated. Will continue CBT approach next session."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
                />
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={reset}
                    disabled={drafting}
                    className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitBrief}
                    disabled={drafting}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" />
                    {drafting ? 'Drafting…' : 'Draft note'}
                  </button>
                </div>
              </div>
            )}

            {tab === 'call' && (
              <div>
                <p className="text-xs text-gray-500 mb-3">
                  Useful for intake calls or when you want to document a phone contact. Pick a call with a transcript.
                </p>
                {loadingCalls && (
                  <div className="py-6 text-center text-sm text-gray-500">Loading recent calls…</div>
                )}
                {!loadingCalls && calls && calls.length === 0 && (
                  <div className="py-6 text-center text-sm text-gray-500">
                    No calls with transcripts found for this patient.
                  </div>
                )}
                {!loadingCalls && calls && calls.length > 0 && (
                  <ul className="space-y-2">
                    {calls.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          disabled={drafting}
                          onClick={() => submitCall(c.id)}
                          className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-teal-500 hover:bg-teal-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                            {formatDate(c.created_at)}
                            {c.call_type && <span className="text-xs text-gray-500 font-normal">· {c.call_type}</span>}
                            {c.duration_seconds && (
                              <span className="text-xs text-gray-500 font-normal">
                                · {Math.round(c.duration_seconds / 60)} min
                              </span>
                            )}
                            {c.crisis_detected && (
                              <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                                <AlertTriangle className="w-3 h-3" />
                                crisis
                              </span>
                            )}
                          </div>
                          {c.summary && (
                            <div className="text-xs text-gray-600 mt-1 line-clamp-2">{c.summary}</div>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {drafting && (
                  <div className="mt-3 text-xs text-teal-700 text-center font-medium">
                    Drafting with Claude…
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function TabButton({
  active, onClick, disabled, icon, children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${
        active
          ? 'border-teal-600 text-teal-700'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      } disabled:opacity-50`}
    >
      {icon}
      {children}
    </button>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}
