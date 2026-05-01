// app/reception/signup/page.tsx
//
// W48 T4 — public Reception-only signup. Shorter form than full
// Harbor: practice_name, owner_email, owner_phone, owner_password.
// On success the user lands on /reception/dashboard with their
// freshly-minted API key shown ONCE in a one-time-display modal.

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function ReceptionSignupPage() {
  const router = useRouter()
  const [practiceName, setPracticeName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerPhone, setOwnerPhone] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{
    practice_id: string
    api_key_plaintext: string
    signalwire_number: string | null
    retell_agent_id: string | null
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true); setError(null)
    try {
      const res = await fetch('/api/reception/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          practice_name: practiceName.trim(),
          owner_email: ownerEmail.trim().toLowerCase(),
          owner_phone: ownerPhone.trim() || null,
          owner_password: ownerPassword,
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Signup failed')
      setResult(j)
    } catch (e) {
      setError((e as Error).message)
    } finally { setSubmitting(false) }
  }

  if (result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#f5f9fb] to-[#eaf5f5] p-4">
        <div className="rounded-2xl bg-white shadow-md p-6 max-w-lg w-full space-y-4 border">
          <h1 className="text-xl font-semibold" style={{ color: '#1f375d' }}>You're set up.</h1>
          <p className="text-sm text-gray-600">
            Your Reception API key is shown once below. Copy and save it — it won't be shown again. Then continue to setup to connect your calendar, customize your greeting, and claim a phone number.
          </p>
          <div className="rounded border bg-gray-50 p-3 font-mono text-xs break-all">
            {result.api_key_plaintext}
          </div>
          <button onClick={() => navigator.clipboard.writeText(result.api_key_plaintext)}
                  className="text-xs text-[#1f375d] hover:underline">
            Copy to clipboard
          </button>
          <div className="text-xs text-gray-500 space-y-1 pt-2">
            <div>Practice ID: <code className="font-mono">{result.practice_id}</code></div>
            {result.signalwire_number && <div>Phone: <code className="font-mono">{result.signalwire_number}</code></div>}
          </div>
          <button onClick={() => router.push('/onboarding/reception')}
                  className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm w-full">
            Continue to setup
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#f5f9fb] to-[#eaf5f5] p-4">
      <div className="rounded-2xl bg-white shadow-md p-6 max-w-md w-full space-y-4 border border-gray-100">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold" style={{ color: '#1f375d' }}>Reception only</h1>
          <p className="text-sm text-gray-600">
            Your EHR stays where it is. Harbor handles the calls.
          </p>
          <p className="text-xs text-gray-500">
            Want full Harbor instead? <Link href="/signup" className="underline text-[#1f375d]">Sign up here</Link>.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm">
            Practice name
            <input value={practiceName} onChange={(e) => setPracticeName(e.target.value)} required
                   className="block w-full border rounded px-2 py-1.5 mt-1" />
          </label>
          <label className="block text-sm">
            Owner email
            <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} required
                   className="block w-full border rounded px-2 py-1.5 mt-1" />
          </label>
          <label className="block text-sm">
            Owner phone (optional)
            <input type="tel" value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)}
                   placeholder="+15555551234"
                   className="block w-full border rounded px-2 py-1.5 mt-1" />
          </label>
          <label className="block text-sm">
            Password
            <input type="password" value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)}
                   required minLength={8}
                   className="block w-full border rounded px-2 py-1.5 mt-1" />
          </label>

          {error && (
            <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <button type="submit" disabled={submitting}
                  className="bg-[#1f375d] text-white px-3 py-2 rounded text-sm w-full disabled:opacity-50">
            {submitting ? 'Setting up…' : 'Create my Reception account'}
          </button>
        </form>
      </div>
    </div>
  )
}
