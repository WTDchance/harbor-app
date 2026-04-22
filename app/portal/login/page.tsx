// app/portal/login/page.tsx
// Patient lands here by clicking the link the therapist sent. We auto-submit
// the token if present in the URL; otherwise show a small manual form.

'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Link2 } from 'lucide-react'

export default function PortalLogin() {
  const router = useRouter()
  const sp = useSearchParams()
  const [token, setToken] = useState(sp.get('token') ?? '')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(tok: string) {
    setWorking(true); setError(null)
    try {
      const res = await fetch('/api/portal/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tok }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Sign-in failed')
      router.push('/portal/home')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
      setWorking(false)
    }
  }

  useEffect(() => {
    const t = sp.get('token')
    if (t) submit(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-teal-50 text-teal-700 mb-4 mx-auto">
          <Link2 className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-semibold text-gray-900 text-center mb-1">Sign in to your portal</h1>
        <p className="text-sm text-gray-500 text-center mb-6">
          If you received a sign-in link from your therapist, paste it below.
        </p>
        <form
          onSubmit={(e) => { e.preventDefault(); submit(token) }}
          className="space-y-3"
        >
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your sign-in token"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          {error && <div className="text-sm text-red-600">{error}</div>}
          <button
            type="submit"
            disabled={working || !token.trim()}
            className="w-full inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg px-4 py-2.5 disabled:opacity-50"
          >
            {working ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
