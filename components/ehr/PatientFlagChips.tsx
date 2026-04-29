// components/ehr/PatientFlagChips.tsx
//
// W49 D5 — read-only flag chips. Pass an array of flag types
// (`active_flags` from the patients-search response).

'use client'

import { PATIENT_FLAG_META, type PatientFlagType } from '@/lib/ehr/patient-flags'

export default function PatientFlagChips({ flags, max = 4, size = 'sm' }: {
  flags: PatientFlagType[] | string[] | undefined | null
  max?: number
  size?: 'xs' | 'sm'
}) {
  if (!flags || flags.length === 0) return null
  const list = (flags as string[])
    .filter(f => (f as any) in PATIENT_FLAG_META)
    .map(f => PATIENT_FLAG_META[f as PatientFlagType])
    .sort((a, b) => b.severity - a.severity)
  const shown = list.slice(0, max)
  const overflow = list.length - shown.length

  const baseCls = size === 'xs'
    ? 'text-[10px] px-1.5 py-0.5'
    : 'text-xs px-2 py-0.5'

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map(m => (
        <span key={m.type} className={`uppercase tracking-wide rounded border ${baseCls} ${m.className}`}>{m.label}</span>
      ))}
      {overflow > 0 && <span className={`uppercase tracking-wide rounded border border-gray-300 bg-gray-50 text-gray-600 ${baseCls}`}>+{overflow}</span>}
    </span>
  )
}
