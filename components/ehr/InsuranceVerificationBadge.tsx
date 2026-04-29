// components/ehr/InsuranceVerificationBadge.tsx
//
// W50 D6 — header strip badge: "Coverage verified Apr 29, $30 copay,
// deductible $1200/$2500" + Re-verify link.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Verification {
  status: 'pending' | 'completed' | 'errored'
  payer_name: string | null
  parsed_summary?: {
    copay_cents?: number | null
    deductible_total_cents?: number | null
    deductible_met_cents?: number | null
    plan_active?: boolean | null
  }
  requested_at: string
  completed_at: string | null
  expires_at: string
}

function d(c: number | null | undefined): string { return c == null ? '—' : `$${(c / 100).toFixed(0)}` }

export default function InsuranceVerificationBadge({ patientId }: { patientId: string }) {
  const [v, setV] = useState<Verification | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/ehr/patients/${patientId}/insurance/latest`)
      .then(r => r.ok ? r.json() : { latest: null })
      .then(j => { if (!cancelled) setV(j.latest) })
      .catch(() => { if (!cancelled) setV(null) })
    return () => { cancelled = true }
  }, [patientId])

  if (v === undefined) return null
  if (!v) {
    return (
      <Link href={`/dashboard/patients/${patientId}/insurance/verify`}
        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
        Verify coverage →
      </Link>
    )
  }

  const ts = v.completed_at ? new Date(v.completed_at) : new Date(v.requested_at)
  const tsStr = ts.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const cls = v.status === 'completed' ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
            : v.status === 'errored' ? 'border-red-300 bg-red-50 text-red-700'
            : 'border-yellow-300 bg-yellow-50 text-yellow-700'

  let summary = `${v.payer_name ?? 'Carrier'} · ${v.status}`
  if (v.status === 'completed') {
    const s = v.parsed_summary ?? {}
    const parts: string[] = [`verified ${tsStr}`]
    if (s.copay_cents != null) parts.push(`${d(s.copay_cents)} copay`)
    if (s.deductible_total_cents != null) parts.push(`deductible ${d(s.deductible_met_cents)}/${d(s.deductible_total_cents)}`)
    summary = `${v.payer_name ?? 'Carrier'} · ${parts.join(' · ')}`
  }

  return (
    <div className="inline-flex items-center gap-2 flex-wrap">
      <span className={`text-xs px-2 py-1 rounded border ${cls}`}>{summary}</span>
      <Link href={`/dashboard/patients/${patientId}/insurance/verify`} className="text-xs text-blue-600 hover:underline">Re-verify</Link>
    </div>
  )
}
