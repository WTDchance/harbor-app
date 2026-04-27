// components/ehr/SmartCodePicker.tsx
//
// Wave 31b — Diagnosis picker that doesn't make therapists scroll
// through every ICD-10 code Valiant-style. Shows three smart sections
// in priority order:
//   1. AI-suggested for THIS patient (top 3 from Sonnet, with rationale)
//   2. Recently used in this practice (last 90 days)
//   3. Full searchable list (all whitelist codes)
//
// Drop-in replacement for CodePicker when you have a patient context.
// Falls back to the dumb CodePicker when patientId is omitted.

'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { X, Search, Sparkles, Clock, RefreshCw } from 'lucide-react'
import { searchCodes, type Code } from '@/lib/ehr/codes'
import { CodePicker } from './CodePicker'

type Props = {
  label: string
  hint?: string
  options: Code[]
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  placeholder?: string
  /** When provided, fetches AI-suggested top-3 + recently-used for this patient/practice. */
  patientId?: string
}

type Suggestion = { code: string; rationale: string }

export function SmartCodePicker(props: Props) {
  const { patientId } = props
  if (!patientId) return <CodePicker {...props} />

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [recent, setRecent] = useState<string[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const codeIndex = useMemo(() => {
    const idx: Record<string, Code> = {}
    for (const c of props.options) idx[c.code] = c
    return idx
  }, [props.options])

  // AI suggestions on first open
  useEffect(() => {
    if (!open || suggestions.length > 0 || aiLoading) return
    setAiLoading(true)
    fetch(`/api/ehr/patients/${patientId}/suggested-diagnoses`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(j => setSuggestions((j.suggestions || []).filter((s: Suggestion) => codeIndex[s.code])))
      .catch(() => setAiError('AI suggestions unavailable'))
      .finally(() => setAiLoading(false))
  }, [open, patientId, codeIndex, suggestions.length, aiLoading])

  // Recently used by this practice — derive from the practice's active
  // treatment plans + signed notes. Best-effort; quiet failure.
  useEffect(() => {
    if (!open) return
    fetch(`/api/ehr/patients/${patientId}/recent-diagnoses`)
      .then(r => r.ok ? r.json() : { codes: [] })
      .then(j => setRecent(j.codes || []))
      .catch(() => {})
  }, [open, patientId])

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [open])

  function pick(code: string) {
    if (!props.value.includes(code)) props.onChange([...props.value, code])
    setQuery('')
  }

  function remove(code: string) {
    props.onChange(props.value.filter(c => c !== code))
  }

  const selectedSet = new Set(props.value)
  const matches = searchCodes(props.options, query, 12)

  // De-duplicate: don't show suggestions/recent in full search if they're already there
  const aiCodes = new Set(suggestions.map(s => s.code))
  const recentCodes = new Set(recent.filter(c => !aiCodes.has(c)))

  return (
    <div className="space-y-2" ref={wrapRef}>
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">{props.label}</label>
        {props.hint && <span className="text-xs text-gray-500">{props.hint}</span>}
      </div>

      {/* Selected chips */}
      {props.value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {props.value.map(code => {
            const c = codeIndex[code]
            return (
              <span
                key={code}
                className="inline-flex items-center gap-1.5 px-2 py-1 bg-teal-50 border border-teal-200 text-teal-900 rounded-md text-xs"
              >
                <span className="font-mono font-semibold">{code}</span>
                <span className="hidden md:inline">— {c?.label || ''}</span>
                {!props.disabled && (
                  <button onClick={() => remove(code)} className="ml-0.5 text-teal-700 hover:text-teal-900">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            disabled={props.disabled}
            placeholder={props.placeholder || 'Search code, name, or keyword…'}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50"
          />
        </div>

        {open && (
          <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-y-auto z-50">
            {/* AI Suggested */}
            {!query && (
              <div className="px-3 py-2 border-b border-gray-100">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-teal-700 uppercase tracking-wide">
                    <Sparkles className="w-3 h-3" />
                    AI Suggested
                  </div>
                  {aiLoading && <RefreshCw className="w-3 h-3 text-gray-400 animate-spin" />}
                </div>
                {aiError && <div className="text-xs text-amber-700 py-1">{aiError}</div>}
                {!aiLoading && !aiError && suggestions.length === 0 && (
                  <div className="text-xs text-gray-500 py-1">Not enough patient data yet to suggest.</div>
                )}
                {suggestions.map(s => {
                  const c = codeIndex[s.code]
                  if (!c) return null
                  const already = selectedSet.has(s.code)
                  return (
                    <button
                      key={s.code}
                      disabled={already}
                      onClick={() => pick(s.code)}
                      className={`w-full text-left px-2 py-1.5 rounded hover:bg-teal-50 ${already ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-sm font-semibold text-teal-700">{s.code}</span>
                        <span className="text-sm text-gray-900">{c.label}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 italic">{s.rationale}</div>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Recently used */}
            {!query && recentCodes.size > 0 && (
              <div className="px-3 py-2 border-b border-gray-100">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                  <Clock className="w-3 h-3" />
                  Recently used in your practice
                </div>
                {Array.from(recentCodes).slice(0, 5).map(code => {
                  const c = codeIndex[code]
                  if (!c) return null
                  const already = selectedSet.has(code)
                  return (
                    <button
                      key={code}
                      disabled={already}
                      onClick={() => pick(code)}
                      className={`w-full text-left px-2 py-1.5 rounded hover:bg-gray-50 ${already ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-sm font-semibold text-gray-700">{code}</span>
                        <span className="text-sm text-gray-900">{c.label}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Search results */}
            <div className="px-3 py-2">
              {query && (
                <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                  Search results
                </div>
              )}
              {!query && (
                <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                  All codes
                </div>
              )}
              {matches.length === 0 && (
                <div className="text-xs text-gray-500 py-1">No matches.</div>
              )}
              {matches.map(c => {
                const already = selectedSet.has(c.code)
                return (
                  <button
                    key={c.code}
                    disabled={already}
                    onClick={() => pick(c.code)}
                    className={`w-full text-left px-2 py-1.5 rounded hover:bg-gray-50 ${already ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-sm font-semibold text-gray-700">{c.code}</span>
                      <span className="text-sm text-gray-900">{c.label}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
