// components/ehr/EventTypePicker.tsx
//
// W49 D4 — drop-in picker for the appointment scheduler. When the user
// changes the event type, surfaces the default duration + CPT codes via
// the onChange callback so the parent form can autofill them.

'use client'

import { useEffect, useMemo, useState } from 'react'

interface EventType {
  id: string; name: string; color: string
  default_duration_minutes: number
  default_cpt_codes: string[]
  allows_telehealth: boolean; allows_in_person: boolean
  is_default: boolean
}

export interface EventTypePickerChange {
  id: string
  duration_minutes: number
  cpt_codes: string[]
  allows_telehealth: boolean
  allows_in_person: boolean
}

export default function EventTypePicker({ value, onChange, disabled }: {
  value: string | null
  onChange: (e: EventTypePickerChange) => void
  disabled?: boolean
}) {
  const [items, setItems] = useState<EventType[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/ehr/practice/event-types')
      .then(r => r.json())
      .then(j => { if (!cancelled) setItems(j.event_types ?? []) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const selected = useMemo(() => items.find(i => i.id === value) ?? null, [items, value])

  // Auto-pick the default the first time the picker has data and no
  // value is set.
  useEffect(() => {
    if (!loading && !value && items.length > 0) {
      const def = items.find(i => i.is_default) ?? items[0]
      if (def) {
        onChange({
          id: def.id, duration_minutes: def.default_duration_minutes,
          cpt_codes: def.default_cpt_codes ?? [],
          allows_telehealth: def.allows_telehealth, allows_in_person: def.allows_in_person,
        })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, value, items])

  if (loading) return <div className="text-xs text-gray-400">Loading event types…</div>
  if (items.length === 0) {
    return <div className="text-xs text-gray-500">
      No event types yet. <a className="text-blue-600 hover:underline" href="/dashboard/settings/event-types">Set them up →</a>
    </div>
  }

  return (
    <div className="space-y-2">
      <select
        disabled={disabled}
        value={value ?? ''}
        onChange={(e) => {
          const it = items.find(i => i.id === e.target.value)
          if (!it) return
          onChange({
            id: it.id, duration_minutes: it.default_duration_minutes,
            cpt_codes: it.default_cpt_codes ?? [],
            allows_telehealth: it.allows_telehealth, allows_in_person: it.allows_in_person,
          })
        }}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
      >
        {items.map(it => (
          <option key={it.id} value={it.id}>
            {it.name} · {it.default_duration_minutes}m{it.default_cpt_codes.length ? ` · ${it.default_cpt_codes.join('/')}` : ''}
          </option>
        ))}
      </select>
      {selected && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: selected.color }} />
          <span className="text-xs text-gray-500">
            {selected.allows_telehealth && 'Telehealth'}
            {selected.allows_telehealth && selected.allows_in_person && ' · '}
            {selected.allows_in_person && 'In-person'}
          </span>
        </div>
      )}
    </div>
  )
}
