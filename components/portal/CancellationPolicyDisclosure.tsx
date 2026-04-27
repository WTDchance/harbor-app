// components/portal/CancellationPolicyDisclosure.tsx
//
// Wave 42 — Patient-facing cancellation-policy disclosure card. Renders
// nothing when the practice has no policy configured. Drop into the
// portal scheduling and cancel flows so patients have the policy in
// front of them before they confirm.
//
// Backed by /api/portal/cancellation-policy (portal-session-scoped).

'use client'

import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'

interface PolicyResp {
  policy_hours: number | null
  cancellation_fee_cents: number | null
  no_show_fee_cents: number | null
  policy_text: string | null
}

interface Props {
  /** Optional headline override; default is "Cancellation policy". */
  title?: string
  /** Compact = no border / smaller padding (for inline scheduling forms). */
  compact?: boolean
}

export function CancellationPolicyDisclosure({ title = 'Cancellation policy', compact = false }: Props) {
  const [policy, setPolicy] = useState<PolicyResp | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/portal/cancellation-policy')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setPolicy(j) })
      .catch(() => { /* silent */ })
    return () => { cancelled = true }
  }, [])

  if (!policy) return null
  const hasPolicy = policy.policy_hours != null
  const hasFee = (policy.cancellation_fee_cents ?? 0) > 0 || (policy.no_show_fee_cents ?? 0) > 0
  if (!hasPolicy && !policy.policy_text) return null

  const dollars = (c: number | null) => (c != null ? `$${(c / 100).toFixed(2)}` : null)

  const containerCls = compact
    ? 'text-xs text-gray-700 mb-3'
    : 'bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 text-sm text-amber-900'

  return (
    <div className={containerCls}>
      {!compact && (
        <div className="flex items-center gap-2 font-semibold mb-1">
          <AlertCircle className="w-4 h-4" />
          {title}
        </div>
      )}
      {policy.policy_text ? (
        <p className="whitespace-pre-line">{policy.policy_text}</p>
      ) : hasPolicy && hasFee ? (
        <p>
          Cancellations with less than {policy.policy_hours} hours&apos; notice are charged
          {policy.cancellation_fee_cents ? ` ${dollars(policy.cancellation_fee_cents)}` : ''}
          {policy.no_show_fee_cents ? `; no-shows are charged ${dollars(policy.no_show_fee_cents)}` : ''}
          .
        </p>
      ) : null}
    </div>
  )
}

export default CancellationPolicyDisclosure
