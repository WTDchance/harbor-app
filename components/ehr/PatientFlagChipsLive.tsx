// components/ehr/PatientFlagChipsLive.tsx
//
// W50 D1 — chips that fetch their own data. Used on patient-detail
// header where we don't want to plumb the flag list through the parent
// payload.

'use client'

import { useEffect, useState } from 'react'
import PatientFlagChips from './PatientFlagChips'

export default function PatientFlagChipsLive({ patientId, max = 8 }: { patientId: string; max?: number }) {
  const [flags, setFlags] = useState<string[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/ehr/patients/${patientId}/flags`)
      .then(r => r.ok ? r.json() : { flags: [] })
      .then(j => { if (!cancelled) setFlags((j.flags ?? []).map((f: any) => f.type)) })
      .catch(() => { if (!cancelled) setFlags([]) })
    return () => { cancelled = true }
  }, [patientId])

  if (flags === null) return <span className="text-xs text-gray-400">…</span>
  if (flags.length === 0) return <span className="text-xs text-gray-400">None</span>
  return <PatientFlagChips flags={flags} max={max} />
}
