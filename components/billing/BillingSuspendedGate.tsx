// components/billing/BillingSuspendedGate.tsx
//
// Client-side guard. Pings /api/billing/subscription once on mount and, if
// the practice is suspended, redirects to /dashboard/settings/billing with
// an interstitial. Drop into the dashboard shell (layout.tsx) so every
// /dashboard/* page enforces the gate.
//
// Edge-middleware can't perform this check today — the suspension flag
// lives in RDS and middleware runs at the edge with no DB connection.

'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { SuspendedBanner } from './SubscriptionBanners'

export function BillingSuspendedGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [suspended, setSuspended] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let aborted = false
    async function check() {
      try {
        const res = await fetch('/api/billing/subscription', { cache: 'no-store' })
        if (!res.ok) {
          // 401/403 means not signed in or not admin — let normal layout
          // gate handle it. Don't render the suspended UI.
          if (!aborted) setChecked(true)
          return
        }
        const data = await res.json()
        if (aborted) return
        const status = data?.practice?.status as string | undefined
        if (status === 'suspended') {
          setSuspended(true)
          if (!pathname?.startsWith('/dashboard/settings/billing')) {
            router.replace('/dashboard/settings/billing?suspended=1')
          }
        }
        setChecked(true)
      } catch {
        if (!aborted) setChecked(true)
      }
    }
    void check()
    return () => {
      aborted = true
    }
  }, [pathname, router])

  if (suspended && pathname?.startsWith('/dashboard/settings/billing')) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <SuspendedBanner />
        {children}
      </div>
    )
  }
  if (suspended) {
    return null // redirect in flight
  }
  if (!checked) return <>{children}</>
  return <>{children}</>
}
