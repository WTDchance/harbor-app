// /onboarding/billing — first-subscription tier picker.
// Practice has just signed up; this page kicks them into Stripe Checkout
// with a 14-day trial on whichever tier they pick.

'use client'

import { useState } from 'react'

const TIERS = [
  {
    key: 'reception_only_monthly',
    name: 'Reception Only',
    price: '$99/mo',
    description:
      'AI receptionist for practices that already have an EHR elsewhere.',
    bullets: [
      'Inbound call handling',
      'Intake & scheduling reminders',
      'Bring-your-own EHR',
    ],
  },
  {
    key: 'solo_cash_pay_monthly',
    name: 'Solo (Cash-Pay)',
    price: '$149/mo',
    description: 'Single-provider cash-pay practice. Full EHR + receptionist.',
    bullets: ['Full Harbor EHR', 'AI receptionist', 'No insurance billing'],
  },
  {
    key: 'solo_in_network_monthly',
    name: 'Solo (In-Network)',
    price: '$299/mo',
    description: 'Single-provider practice that bills insurance.',
    bullets: [
      'Full Harbor EHR',
      'AI receptionist',
      'Stedi eligibility & 837 claims',
    ],
    recommended: true,
  },
  {
    key: 'group_practice_monthly',
    name: 'Group Practice',
    price: '$899/mo',
    description: 'Multi-provider group practice.',
    bullets: [
      'All in-network features',
      'Supervision / cosign workflows',
      'Multi-clinician scheduling',
    ],
  },
] as const

export default function OnboardingBillingPage() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handlePick(tier: string) {
    setBusy(tier)
    setError(null)
    try {
      const res = await fetch('/api/billing/checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) {
        throw new Error(data?.error ?? 'checkout_failed')
      }
      window.location.href = data.url as string
    } catch (e) {
      setError((e as Error).message)
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-3xl font-semibold mb-2">Pick your Harbor plan</h1>
      <p className="text-neutral-600 mb-8">
        Every plan starts with a 14-day free trial. No charge today; you can
        cancel any time before day 14.
      </p>

      {error ? (
        <div className="mb-6 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((tier) => (
          <div
            key={tier.key}
            className={`rounded-lg border p-5 ${
              tier.recommended
                ? 'border-blue-500 ring-2 ring-blue-200'
                : 'border-neutral-200'
            }`}
          >
            {tier.recommended ? (
              <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                Most common
              </span>
            ) : null}
            <h2 className="mt-2 text-xl font-semibold">{tier.name}</h2>
            <p className="mt-1 text-2xl font-bold">{tier.price}</p>
            <p className="mt-2 text-sm text-neutral-600">{tier.description}</p>
            <ul className="mt-4 space-y-1 text-sm text-neutral-700">
              {tier.bullets.map((b) => (
                <li key={b}>• {b}</li>
              ))}
            </ul>
            <button
              onClick={() => handlePick(tier.key)}
              disabled={busy !== null}
              className="mt-5 w-full rounded bg-blue-600 px-4 py-2 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {busy === tier.key ? 'Redirecting…' : 'Start 14-day trial'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
