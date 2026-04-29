// app/(reception)/reception/dashboard/layout.tsx
//
// W48 T5 — Reception-only layout. Dedicated sidebar (Calls / Agent /
// API Keys / Settings) — no EHR modules. Tier gate redirects
// ehr_full / ehr_only practices to /dashboard.

'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'

const NAV = [
  { href: '/reception/dashboard',                label: 'Calls',         exact: true },
  { href: '/reception/dashboard/agent-config',   label: 'Agent config',  exact: false },
  { href: '/reception/dashboard/api-keys',       label: 'API keys',      exact: false },
  { href: '/reception/dashboard/settings',       label: 'Settings',      exact: false },
]

export default function ReceptionLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [practiceName, setPracticeName] = useState<string | null>(null)
  const [tier, setTier] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/aws/whoami', { credentials: 'include' })
        if (!res.ok) { router.replace('/login/aws'); return }
        const j = await res.json()
        if (cancelled) return
        setPracticeName(j.practice?.name ?? null)
        const t = j.practice?.productTier ?? 'ehr_full'
        setTier(t)
        // Tier gate: redirect anyone who doesn't belong here.
        if (t === 'ehr_full' || t === 'ehr_only') {
          router.replace('/dashboard')
          return
        }
        setLoading(false)
      } catch {
        if (!cancelled) router.replace('/login/aws')
      }
    })()
    return () => { cancelled = true }
  }, [router])

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading…</div>
  }

  function isActive(item: typeof NAV[number]): boolean {
    if (item.exact) return pathname === item.href
    return pathname?.startsWith(item.href) ?? false
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-white border-r border-gray-100 flex-shrink-0">
        <Link href="/reception/dashboard"
              className="flex items-center gap-2 px-4 py-4 border-b border-gray-100 hover:bg-gray-50/80">
          <img src="/harbor-icon-clean.png" alt="" className="h-8 w-auto" />
          <div className="min-w-0">
            <p className="text-sm font-bold leading-tight truncate" style={{ color: '#1f375d' }}>
              {practiceName || 'Harbor Reception'}
            </p>
            <p className="text-xs leading-tight" style={{ color: '#52bfc0' }}>Reception</p>
          </div>
        </Link>
        <nav className="px-2 py-3 space-y-0.5">
          {NAV.map((item) => {
            const active = isActive(item)
            return (
              <Link key={item.href} href={item.href}
                    className={`flex items-center gap-2 rounded-lg text-sm font-medium px-3 py-2 ${
                      active ? 'text-white' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                    style={active ? { backgroundColor: '#1f375d' } : undefined}>
                {item.label}
              </Link>
            )
          })}
        </nav>
        {tier === 'reception_only' && (
          <div className="absolute bottom-3 left-2 right-2 text-[10px] text-gray-400 px-3">
            Reception-only tier. <Link href="/dashboard/settings" className="underline">Upgrade</Link> to add EHR.
          </div>
        )}
      </aside>
      <main className="flex-1 bg-gray-50 overflow-x-hidden">{children}</main>
    </div>
  )
}
