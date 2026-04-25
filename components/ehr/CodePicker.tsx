// components/ehr/CodePicker.tsx
// Searchable multi-select for CPT or ICD-10 codes. Therapists pick chips;
// free-text entry is also allowed for codes not in the curated list.

'use client'

import { useState, useRef, useEffect } from 'react'
import { X, Search } from 'lucide-react'
import { searchCodes, type Code } from '@/lib/ehr/codes'

type Props = {
  label: string
  hint?: string
  options: Code[]
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  placeholder?: string
}

export function CodePicker({
  label, hint, options, value, onChange, disabled, placeholder,
}: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [open])

  const matches = searchCodes(options, query, 12)
  const selectedSet = new Set(value)

  function add(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    if (selectedSet.has(trimmed)) return
    onChange([...value, trimmed])
    setQuery('')
  }

  function remove(code: string) {
    onChange(value.filter((c) => c !== code))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && query.trim()) {
      e.preventDefault()
      // Prefer a matching code if the query exactly matches one,
      // otherwise treat as free-text entry.
      const exact = options.find(
        (o) => o.code.toLowerCase() === query.trim().toLowerCase(),
      )
      add(exact ? exact.code : query.trim())
    } else if (e.key === 'Backspace' && !query && value.length > 0) {
      remove(value[value.length - 1])
    }
  }

  // Label lookup for display on the chips.
  function labelFor(code: string): string | undefined {
    return options.find((o) => o.code === code)?.label
  }

  return (
    <div ref={wrapRef} className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {hint && <span className="text-xs text-gray-500 font-normal"> · {hint}</span>}
      </label>

      {/* Chip + input combo */}
      <div
        className={`w-full border border-gray-200 rounded-lg px-2 py-1.5 min-h-[38px] flex flex-wrap gap-1 items-center ${
          disabled ? 'bg-gray-50' : 'bg-white focus-within:ring-2 focus-within:ring-teal-500'
        }`}
        onClick={() => !disabled && setOpen(true)}
      >
        {value.map((c) => {
          const lab = labelFor(c)
          return (
            <span
              key={c}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-teal-50 text-teal-800 border border-teal-200"
              title={lab}
            >
              {c}
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); remove(c) }}
                  className="text-teal-600 hover:text-teal-900"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          )
        })}
        <input
          disabled={disabled}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? (placeholder ?? 'Type to search or paste a code…') : ''}
          className="flex-1 min-w-[120px] bg-transparent outline-none text-sm py-1 disabled:bg-gray-50"
        />
      </div>

      {/* Dropdown */}
      {open && !disabled && matches.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {matches.map((m) => {
            const already = selectedSet.has(m.code)
            return (
              <button
                key={m.code}
                type="button"
                disabled={already}
                onClick={() => { add(m.code); setOpen(false) }}
                className={`w-full text-left px-3 py-2 text-sm flex items-start gap-2 ${
                  already ? 'bg-gray-50 text-gray-400' : 'hover:bg-teal-50'
                }`}
              >
                <span className="font-mono text-xs font-semibold text-teal-700 mt-0.5 shrink-0 w-14">
                  {m.code}
                </span>
                <span className="text-gray-700">{m.label}</span>
                {already && <span className="ml-auto text-xs text-gray-400">added</span>}
              </button>
            )
          })}
          {query.trim() && !matches.some((m) => m.code.toLowerCase() === query.trim().toLowerCase()) && (
            <button
              type="button"
              onClick={() => { add(query.trim()); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm border-t border-gray-100 text-gray-600 hover:bg-teal-50 flex items-center gap-2"
            >
              <Search className="w-3.5 h-3.5 text-gray-400" />
              Add <span className="font-mono font-semibold">{query.trim()}</span> as custom code
            </button>
          )}
        </div>
      )}
    </div>
  )
}
