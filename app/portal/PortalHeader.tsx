// app/portal/PortalHeader.tsx — header with optional sign-out.
// Sign-out only shows when the visitor has a session; we don't want to
// show it on /portal/login for clean first-impression UX.

'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { LogOut } from 'lucide-react'

export function PortalHeader() {
  const router = useRouter()
  const pathname = usePathname()
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    // Best-effort check — we don't block rendering on it.
    fetch('/api/portal/me').then((r) => setSignedIn(r.ok)).catch(() => {})
  }, [pathname])

  async function signOut() {
    await fetch('/api/portal/logout', { method: 'POST' })
    router.replace('/portal/login')
  }

  return (
    <header className="bg-white border-b border-gray-200">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/harbor-icon-clean.png" alt="" className="h-7 w-auto" />
          <span className="font-semibold text-gray-900">Harbor Patient Portal</span>
        </div>
        {signedIn && pathname !== '/portal/login' && (
          <button
            type="button"
            onClick={signOut}
            className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        )}
      </div>
    </header>
  )
}
