// components/ehr/RecurrencePicker.tsx
// Wave 38 TS1 — "Repeats" picker for the appointment create / edit form.
//
// Emits one of:
//   'none' | 'weekly' | 'biweekly' | 'monthly' | <RRULE>
//
// where the named presets get expanded server-side via lib/aws/ehr/recurrence.ts.

'use client'

import { useState } from 'react'

type Props = {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}

const PRESETS = [
  { id: 'none',     label: "Doesn't repeat" },
  { id: 'weekly',   label: 'Weekly (12 sessions)' },
  { id: 'biweekly', label: 'Every 2 weeks (12 sessions)' },
  { id: 'monthly',  label: 'Monthly (12 sessions)' },
  { id: 'custom',   label: 'Custom RRULE…' },
] as const

export function RecurrencePicker({ value, onChange, disabled }: Props) {
  const isPreset = ['none', 'weekly', 'biweekly', 'monthly'].includes(value)
  const [mode, setMode] = useState<string>(isPreset ? value : 'custom')
  const [custom, setCustom] = useState<string>(isPreset ? '' : value)

  function emit(nextMode: string, nextCustom: string) {
    if (nextMode === 'custom') {
      onChange(nextCustom.trim() || 'none')
    } else {
      onChange(nextMode)
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Repeats</label>
      <select
        disabled={disabled}
        value={mode}
        onChange={(e) => { setMode(e.target.value); emit(e.target.value, custom) }}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50 min-h-[44px]"
      >
        {PRESETS.map(p => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      {mode === 'custom' && (
        <div className="mt-2">
          <input
            type="text"
            disabled={disabled}
            value={custom}
            onChange={(e) => { setCustom(e.target.value); emit('custom', e.target.value) }}
            placeholder="FREQ=WEEKLY;BYDAY=MO,WE;COUNT=24"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50 min-h-[44px]"
          />
          <p className="text-[10px] text-gray-500 mt-1">
            RFC 5545 RRULE. Supported: FREQ (DAILY/WEEKLY/MONTHLY/YEARLY),
            INTERVAL, COUNT, UNTIL, BYDAY. Cap 52 occurrences.
          </p>
        </div>
      )}
    </div>
  )
}
