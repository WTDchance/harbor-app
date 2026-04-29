// components/reception/TierSwitcher.tsx
//
// W48 T6 — small top-bar pill for practices on product_tier='both'.
// Lets the user flip between EHR and Reception views. The choice is
// stored in localStorage as a per-user pref; a future PR can move
// this into the W46 T6 user_layout JSONB once we want it to persist
// across devices.

'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

const STORAGE_KEY = 'harbor_active_tier_view_v1'

export default function TierSwitcher({ tier }: { tier: string }) {
  const pathname = usePathname() || ''
  const [hint, setHint] = useState<'ehr' | 'reception' | null>(null)

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(STORAGE_KEY)
      if (v === 'ehr' || v === 'reception') setHint(v)
    } catch {}
  }, [])

  if (tier !== 'both') return null

  const onReception = pathname.startsWith('/reception/dashboard')
  const altLabel = onReception ? 'EHR view' : 'Reception view'
  const altHref  = onReception ? '/dashboard' : '/reception/dashboard'

  function pick(view: 'ehr' | 'reception') {
    try { window.localStorage.setItem(STORAGE_KEY, view) } catch {}
    setHint(view)
  }

  return (
    <Link href={altHref}
          onClick={() => pick(onReception ? 'ehr' : 'reception')}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
      Switch to {altLabel}
    </Link>
  )
}
