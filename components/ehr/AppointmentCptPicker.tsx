// components/ehr/AppointmentCptPicker.tsx
//
// Wave 38 / TS6 — CPT picker for the appointment scheduling form.
//
// Restricted to the six service codes practices actually book sessions
// against. Everything else stays in the post-session note picker
// (lib/ehr/codes.ts has the long list). Modifier 95 is auto-applied by
// the parent form when appointment_type === 'telehealth'.

'use client'

import { CPT_CODES } from '@/lib/ehr/codes'

const SCHEDULABLE_CPT_CODES = ['90791', '90834', '90837', '90847', '90853', '90839']

export function AppointmentCptPicker({
  value,
  onChange,
  className = '',
}: {
  value: string | null | undefined
  onChange: (code: string | null) => void
  className?: string
}) {
  const options = CPT_CODES.filter((c) => SCHEDULABLE_CPT_CODES.includes(c.code))
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        CPT code <span className="text-gray-400 font-normal">(optional)</span>
      </label>
      <select
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">— Select code —</option>
        {options.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} — {c.label}
          </option>
        ))}
      </select>
    </div>
  )
}
